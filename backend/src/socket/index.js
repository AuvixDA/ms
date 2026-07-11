const { Server } = require('socket.io');
const prisma = require('../prisma');
const { verifySocketToken } = require('../middleware/auth');
const { notifyUser } = require('../push');
const { serializeMessage, MESSAGE_SENDER_INCLUDE, REPLY_PREVIEW_INCLUDE } = require('../messageSerializer');

// userId -> Set of connected socket ids (a user can have multiple tabs/devices)
const onlineUsers = new Map();

function markOnline(userId, socketId) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
}

function markOffline(userId, socketId) {
  const set = onlineUsers.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) onlineUsers.delete(userId);
}

function isOnline(userId) {
  return onlineUsers.has(userId);
}

// True if any of the user's connected sockets currently has this conversation open and
// in the foreground (see the conversation:active/inactive handlers below). Used to skip
// push notifications for a chat the user is already looking at, even while they're online
// in another tab or another conversation.
function isViewingConversation(userId, conversationId) {
  if (!ioInstance) return false;
  const socketIds = onlineUsers.get(userId);
  if (!socketIds) return false;
  for (const socketId of socketIds) {
    if (ioInstance.sockets.sockets.get(socketId)?.activeConversationId === conversationId) return true;
  }
  return false;
}

let ioInstance = null;

function getIo() {
  return ioInstance;
}

// Join every currently-connected socket of a user into a conversation room,
// used when someone adds them to a group so they start receiving events immediately.
function joinUserToConversation(userId, conversationId) {
  if (!ioInstance) return;
  const socketIds = onlineUsers.get(userId);
  if (!socketIds) return;
  socketIds.forEach((socketId) => {
    ioInstance.sockets.sockets.get(socketId)?.join(`conversation:${conversationId}`);
  });
}

// Used when someone is removed from (or leaves) a group, so their sockets stop
// receiving further events for a conversation they're no longer part of.
function leaveUserFromConversation(userId, conversationId) {
  if (!ioInstance) return;
  const socketIds = onlineUsers.get(userId);
  if (!socketIds) return;
  socketIds.forEach((socketId) => {
    ioInstance.sockets.sockets.get(socketId)?.leave(`conversation:${conversationId}`);
  });
}

function initSocket(httpServer, frontendOrigin) {
  const io = new Server(httpServer, {
    cors: { origin: frontendOrigin, credentials: true },
  });
  ioInstance = io;

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = verifySocketToken(token);
      socket.userId = payload.userId;
      next();
    } catch (err) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { userId } = socket;
    markOnline(userId, socket.id);
    socket.broadcast.emit('presence:update', { userId, online: true });

    // Register every listener synchronously, before any `await`, so a client that emits
    // right after connecting can never race ahead of us and have its event dropped.
    socket.on('conversation:join', ({ conversationId }) => {
      socket.join(`conversation:${conversationId}`);
    });

    // Tracks which conversation (if any) this socket currently has open in the
    // foreground, so message:send can decide whether a push notification is needed.
    socket.on('conversation:active', ({ conversationId }) => {
      socket.activeConversationId = conversationId;
    });

    socket.on('conversation:inactive', ({ conversationId }) => {
      if (socket.activeConversationId === conversationId) socket.activeConversationId = null;
    });

    socket.on('typing', ({ conversationId, isTyping }) => {
      socket.to(`conversation:${conversationId}`).emit('typing', { conversationId, userId, isTyping });
    });

    socket.on('message:send', async ({ conversationId, text, fileUrl, fileName, replyToId, forwardedFromName }, ack) => {
      try {
        const membership = await prisma.conversationParticipant.findUnique({
          where: { userId_conversationId: { userId, conversationId } },
        });
        if (!membership) {
          if (ack) ack({ error: 'Not a participant of this conversation' });
          return;
        }

        // Only honor replyToId if it actually points at a message in this same
        // conversation — silently drop it otherwise rather than failing the whole send.
        let validReplyToId = null;
        if (replyToId) {
          const replyTarget = await prisma.message.findUnique({ where: { id: replyToId } });
          if (replyTarget && replyTarget.conversationId === conversationId) validReplyToId = replyToId;
        }

        // Forwarding intentionally stores only the original sender's display name as plain
        // text (no relation back to the source message/conversation) — the recipient of a
        // forward has no business being able to reach into a conversation they're not in.
        const forwardedFrom =
          typeof forwardedFromName === 'string' && forwardedFromName.trim() ? forwardedFromName.trim().slice(0, 100) : null;

        const message = await prisma.message.create({
          data: {
            conversationId,
            senderId: userId,
            text: text || null,
            fileUrl: fileUrl || null,
            fileName: fileName || null,
            replyToId: validReplyToId,
            forwardedFromName: forwardedFrom,
          },
          include: { sender: MESSAGE_SENDER_INCLUDE, ...REPLY_PREVIEW_INCLUDE },
        });

        const serialized = serializeMessage(message);
        io.to(`conversation:${conversationId}`).emit('message:new', serialized);
        if (ack) ack({ message: serialized });

        // A new message un-hides the conversation for anyone who had previously
        // "deleted" it from their own chat list, and rejoins their sockets to the room
        // (hiding a chat leaves it — see the DELETE /conversations/:id route) so they keep
        // receiving live updates for it going forward.
        const previouslyHidden = await prisma.conversationParticipant.findMany({
          where: { conversationId, userId: { not: userId }, hiddenAt: { not: null } },
          select: { userId: true },
        });
        if (previouslyHidden.length > 0) {
          await prisma.conversationParticipant.updateMany({
            where: { conversationId, userId: { not: userId }, hiddenAt: { not: null } },
            data: { hiddenAt: null },
          });
          previouslyHidden.forEach((p) => joinUserToConversation(p.userId, conversationId));
        }

        const participants = await prisma.conversationParticipant.findMany({
          where: { conversationId, userId: { not: userId } },
        });
        participants.forEach((p) => {
          if (!p.mutedAt && !isViewingConversation(p.userId, conversationId)) {
            notifyUser(p.userId, {
              title: message.sender.name,
              body: message.text || 'Отправил файл',
              conversationId,
            }).catch((err) => console.error('[push] notifyUser failed', err));
          }
        });
      } catch (err) {
        console.error('[socket] message:send failed', err);
        if (ack) ack({ error: 'Failed to send message' });
      }
    });

    socket.on('presence:query', async ({ userIds }, ack) => {
      const ids = userIds || [];
      const offlineIds = ids.filter((id) => !isOnline(id));
      let lastSeenById = {};
      if (offlineIds.length > 0) {
        const users = await prisma.user.findMany({
          where: { id: { in: offlineIds } },
          select: { id: true, lastSeenAt: true },
        });
        lastSeenById = Object.fromEntries(users.map((u) => [u.id, u.lastSeenAt]));
      }
      const result = {};
      ids.forEach((id) => {
        result[id] = { online: isOnline(id), lastSeenAt: lastSeenById[id] || null };
      });
      if (ack) ack(result);
    });

    socket.on('disconnect', () => {
      markOffline(userId, socket.id);
      if (!isOnline(userId)) {
        const lastSeenAt = new Date();
        prisma.user
          .update({ where: { id: userId }, data: { lastSeenAt } })
          .catch((err) => console.error('[socket] failed to persist lastSeenAt', err));
        socket.broadcast.emit('presence:update', { userId, online: false, lastSeenAt });
      }
    });

    // Join a room per conversation the user belongs to, so messages can be broadcast by
    // conversationId. Safe to do after listener registration since this only adds rooms —
    // any 'conversation:join' the client fires in the meantime already works standalone.
    prisma.conversationParticipant
      .findMany({ where: { userId } })
      .then((memberships) => memberships.forEach((m) => socket.join(`conversation:${m.conversationId}`)))
      .catch((err) => console.error('[socket] failed to join conversation rooms', err));
  });

  return io;
}

module.exports = { initSocket, isOnline, getIo, joinUserToConversation, leaveUserFromConversation };
