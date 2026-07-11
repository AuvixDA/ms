const { Server } = require('socket.io');
const prisma = require('../prisma');
const { verifySocketToken } = require('../middleware/auth');
const { notifyUser } = require('../push');

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

    socket.on('typing', ({ conversationId, isTyping }) => {
      socket.to(`conversation:${conversationId}`).emit('typing', { conversationId, userId, isTyping });
    });

    socket.on('message:send', async ({ conversationId, text, fileUrl, fileName }, ack) => {
      try {
        const membership = await prisma.conversationParticipant.findUnique({
          where: { userId_conversationId: { userId, conversationId } },
        });
        if (!membership) {
          if (ack) ack({ error: 'Not a participant of this conversation' });
          return;
        }

        const message = await prisma.message.create({
          data: {
            conversationId,
            senderId: userId,
            text: text || null,
            fileUrl: fileUrl || null,
            fileName: fileName || null,
          },
          include: { sender: { select: { id: true, name: true, avatarUrl: true } } },
        });

        io.to(`conversation:${conversationId}`).emit('message:new', message);
        if (ack) ack({ message });

        // A new message un-hides the conversation for anyone who had previously
        // "deleted" it from their own chat list.
        await prisma.conversationParticipant.updateMany({
          where: { conversationId, userId: { not: userId }, hiddenAt: { not: null } },
          data: { hiddenAt: null },
        });

        const participants = await prisma.conversationParticipant.findMany({
          where: { conversationId, userId: { not: userId } },
        });
        participants.forEach((p) => {
          if (!p.mutedAt && !isOnline(p.userId)) {
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

    socket.on('presence:query', ({ userIds }, ack) => {
      const result = {};
      (userIds || []).forEach((id) => {
        result[id] = isOnline(id);
      });
      if (ack) ack(result);
    });

    socket.on('disconnect', () => {
      markOffline(userId, socket.id);
      if (!isOnline(userId)) {
        socket.broadcast.emit('presence:update', { userId, online: false });
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
