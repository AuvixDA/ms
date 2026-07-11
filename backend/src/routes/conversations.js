const express = require('express');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { getIo, joinUserToConversation, leaveUserFromConversation } = require('../socket');
const asyncHandler = require('../asyncHandler');
const { serializeMessage, MESSAGE_SENDER_INCLUDE, REPLY_PREVIEW_INCLUDE, REACTIONS_INCLUDE } = require('../messageSerializer');

const router = express.Router();

const MESSAGES_PAGE_SIZE = 50;

function serializeConversation(c, currentUserId) {
  const self = c.participants.find((p) => p.userId === currentUserId);
  const lastMessage = c.messages?.[0] ? serializeMessage(c.messages[0]) : null;
  const selfLastReadAt = self?.lastReadAt || null;
  const unreadCount = c.unreadCount ?? 0;

  return {
    id: c.id,
    isGroup: c.isGroup,
    name: c.name,
    ownerId: c.ownerId,
    participants: c.participants
      .filter((p) => p.userId !== currentUserId)
      .map((p) => ({
        id: p.user.id,
        name: p.user.name,
        username: p.user.username,
        avatarUrl: p.user.avatarUrl,
        lastReadAt: p.lastReadAt,
      })),
    lastMessage,
    unreadCount,
    archived: !!self?.archivedAt,
    muted: !!self?.mutedAt,
    lastReadAt: selfLastReadAt,
  };
}

async function requireMembership(conversationId, userId) {
  return prisma.conversationParticipant.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
  });
}

// List all conversations for the current user (excludes ones hidden/deleted by them),
// with the last message, other participants, and an unread-message count.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const participations = await prisma.conversationParticipant.findMany({
    where: { userId: req.userId, hiddenAt: null },
    include: {
      conversation: {
        include: {
          participants: { include: { user: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  });

  const conversations = await Promise.all(
    participations.map(async (p) => {
      const unreadCount = await prisma.message.count({
        where: {
          conversationId: p.conversationId,
          senderId: { not: req.userId },
          deletedAt: null,
          createdAt: p.lastReadAt ? { gt: p.lastReadAt } : undefined,
        },
      });
      return { ...p.conversation, unreadCount };
    })
  );

  conversations.sort((a, b) => {
    const aTime = a.messages[0]?.createdAt ?? a.createdAt;
    const bTime = b.messages[0]?.createdAt ?? b.createdAt;
    return new Date(bTime) - new Date(aTime);
  });

  res.json({ conversations: conversations.map((c) => serializeConversation(c, req.userId)) });
}));

// Create a new conversation (1-1 or group). participantIds should not include the creator.
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { participantIds, isGroup, name } = req.body;

  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return res.status(400).json({ error: 'participantIds is required' });
  }

  const allParticipantIds = Array.from(new Set([req.userId, ...participantIds]));

  if (!isGroup && allParticipantIds.length === 2) {
    const existing = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: allParticipantIds.map((id) => ({
          participants: { some: { userId: id } },
        })),
      },
      include: { participants: { include: { user: true } } },
    });

    if (existing && existing.participants.length === 2) {
      // Re-surface the conversation for the current user in case they had previously
      // hidden ("deleted") it from their own list. Hiding leaves the socket room (see the
      // DELETE handler below), so rejoin it here to keep receiving live updates.
      await prisma.conversationParticipant.updateMany({
        where: { conversationId: existing.id, userId: req.userId, hiddenAt: { not: null } },
        data: { hiddenAt: null },
      });
      joinUserToConversation(req.userId, existing.id);
      return res.json({ conversation: existing, alreadyExisted: true });
    }
  }

  const conversation = await prisma.conversation.create({
    data: {
      isGroup: !!isGroup,
      name: isGroup ? name : null,
      ownerId: isGroup ? req.userId : null,
      participants: {
        create: allParticipantIds.map((userId) => ({ userId })),
      },
    },
    include: { participants: { include: { user: true } } },
  });

  // Join every other participant's already-connected sockets into the new conversation's
  // room and let them know it exists, so it shows up in their chat list immediately instead
  // of only after their next reconnect.
  allParticipantIds.forEach((userId) => joinUserToConversation(userId, conversation.id));
  getIo()?.to(`conversation:${conversation.id}`).emit('conversation:new', { conversationId: conversation.id });

  res.status(201).json({ conversation });
}));

// Details for a single conversation (used for the chat header and group info panel).
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { participants: { include: { user: true } } },
  });
  if (!conversation) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  res.json({ conversation: serializeConversation(conversation, req.userId) });
}));

// Rename a group conversation.
router.patch('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  const existing = await prisma.conversation.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  if (!existing.isGroup) {
    return res.status(400).json({ error: 'Only group conversations can be renamed' });
  }
  if (existing.ownerId && existing.ownerId !== req.userId) {
    return res.status(403).json({ error: 'Only the group owner can rename it' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const conversation = await prisma.conversation.update({
    where: { id },
    data: { name: name.trim() },
    include: { participants: { include: { user: true } } },
  });

  getIo()?.to(`conversation:${id}`).emit('conversation:updated', { conversationId: id });
  res.json({ conversation: serializeConversation(conversation, req.userId) });
}));

// Update the current user's own settings for a conversation: archive/unarchive, mute/unmute.
router.patch('/:id/settings', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { archived, muted } = req.body;

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  const data = {};
  if (typeof archived === 'boolean') data.archivedAt = archived ? new Date() : null;
  if (typeof muted === 'boolean') data.mutedAt = muted ? new Date() : null;

  const updated = await prisma.conversationParticipant.update({
    where: { userId_conversationId: { userId: req.userId, conversationId: id } },
    data,
  });

  res.json({ archived: !!updated.archivedAt, muted: !!updated.mutedAt });
}));

// Mark a conversation as read up to now for the current user, and let other participants
// know so their "read" ticks on messages they sent can update in real time.
router.post('/:id/read', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  const readAt = new Date();
  await prisma.conversationParticipant.update({
    where: { userId_conversationId: { userId: req.userId, conversationId: id } },
    data: { lastReadAt: readAt },
  });

  getIo()
    ?.to(`conversation:${id}`)
    .emit('conversation:read', { conversationId: id, userId: req.userId, readAt });

  res.json({ lastReadAt: readAt });
}));

// Hide ("delete") a conversation from the current user's own chat list. The conversation
// and its history are untouched for other participants, and it reappears for this user
// automatically if a new message arrives.
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  await prisma.conversationParticipant.update({
    where: { userId_conversationId: { userId: req.userId, conversationId: id } },
    data: { hiddenAt: new Date() },
  });

  // Stop delivering live events for a chat the user no longer wants to see; they rejoin
  // automatically if it's re-surfaced (see the POST '/' and message:send handlers).
  leaveUserFromConversation(req.userId, id);

  res.json({ ok: true });
}));

// Add participants to a group conversation.
router.post('/:id/participants', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { userIds } = req.body;

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  const existing = await prisma.conversation.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  if (!existing.isGroup) {
    return res.status(400).json({ error: 'Only group conversations support adding participants' });
  }
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: 'userIds is required' });
  }

  const currentParticipants = await prisma.conversationParticipant.findMany({ where: { conversationId: id } });
  const currentIds = new Set(currentParticipants.map((p) => p.userId));
  const newIds = userIds.filter((uid) => !currentIds.has(uid));

  if (newIds.length > 0) {
    await prisma.conversationParticipant.createMany({
      data: newIds.map((userId) => ({ userId, conversationId: id })),
    });
  }

  newIds.forEach((userId) => joinUserToConversation(userId, id));

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { participants: { include: { user: true } } },
  });

  getIo()?.to(`conversation:${id}`).emit('conversation:updated', { conversationId: id });
  res.json({ conversation: serializeConversation(conversation, req.userId) });
}));

// Remove a participant from a group (or leave it yourself).
router.delete('/:id/participants/:userId', requireAuth, asyncHandler(async (req, res) => {
  const { id, userId } = req.params;

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  const existing = await prisma.conversation.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  if (!existing.isGroup) {
    return res.status(400).json({ error: 'Only group conversations support removing participants' });
  }
  // Anyone can remove themselves (leave); removing someone else requires being the owner.
  // Groups created before ownership existed have no ownerId — leave those unrestricted
  // rather than locking everyone out of moderating them.
  const isSelf = userId === req.userId;
  const isOwner = !existing.ownerId || existing.ownerId === req.userId;
  if (!isSelf && !isOwner) {
    return res.status(403).json({ error: 'Only the group owner can remove other participants' });
  }

  await prisma.conversationParticipant
    .delete({ where: { userId_conversationId: { userId, conversationId: id } } })
    .catch(() => {});

  // Hand ownership to the longest-standing remaining member instead of leaving the group
  // permanently unmoderatable (existing.ownerId would otherwise still point at someone who
  // is no longer a participant, and the isOwner check above never matches anyone again).
  if (existing.ownerId === userId) {
    const [nextOwner] = await prisma.conversationParticipant.findMany({
      where: { conversationId: id },
      orderBy: { joinedAt: 'asc' },
      take: 1,
    });
    await prisma.conversation.update({
      where: { id },
      data: { ownerId: nextOwner?.userId || null },
    });
  }

  getIo()?.to(`conversation:${id}`).emit('conversation:updated', { conversationId: id });
  getIo()?.to(`conversation:${id}`).emit('conversation:removed', { conversationId: id, userId });
  leaveUserFromConversation(userId, id);
  res.json({ ok: true });
}));

// Message history for a conversation. Pass `before` (a message id) to load the page that
// precedes it, for infinite-scroll-style pagination — or `around` (a message id, typically
// from a search result) to jump straight to a window centered on that message instead.
router.get('/:id/messages', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { before, around } = req.query;
  const limit = Math.min(Number(req.query.limit) || MESSAGES_PAGE_SIZE, 100);

  const membership = await prisma.conversationParticipant.findUnique({
    where: { userId_conversationId: { userId: req.userId, conversationId: id } },
  });
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  if (around) {
    const target = await prisma.message.findUnique({ where: { id: around } });
    if (!target || target.conversationId !== id) {
      return res.status(400).json({ error: 'Invalid around cursor' });
    }

    const half = Math.floor(limit / 2);
    const [olderHalf, newerHalf] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: id, createdAt: { lt: target.createdAt } },
        orderBy: { createdAt: 'desc' },
        take: half,
        include: { sender: MESSAGE_SENDER_INCLUDE, ...REPLY_PREVIEW_INCLUDE, ...REACTIONS_INCLUDE },
      }),
      prisma.message.findMany({
        where: { conversationId: id, createdAt: { gte: target.createdAt } },
        orderBy: { createdAt: 'asc' },
        take: limit - half,
        include: { sender: MESSAGE_SENDER_INCLUDE, ...REPLY_PREVIEW_INCLUDE, ...REACTIONS_INCLUDE },
      }),
    ]);

    const messages = [...olderHalf.reverse(), ...newerHalf].map(serializeMessage);
    return res.json({
      messages,
      hasMore: olderHalf.length === half,
      hasNewer: newerHalf.length === limit - half,
    });
  }

  let cursorDate;
  if (before) {
    const cursorMessage = await prisma.message.findUnique({ where: { id: before } });
    if (!cursorMessage || cursorMessage.conversationId !== id) {
      return res.status(400).json({ error: 'Invalid before cursor' });
    }
    cursorDate = cursorMessage.createdAt;
  }

  const page = await prisma.message.findMany({
    where: {
      conversationId: id,
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    include: { sender: MESSAGE_SENDER_INCLUDE, ...REPLY_PREVIEW_INCLUDE, ...REACTIONS_INCLUDE },
  });

  const hasMore = page.length > limit;
  const messages = page.slice(0, limit).reverse().map(serializeMessage);

  res.json({ messages, hasMore, hasNewer: false });
}));

// Search messages by text within a single conversation, most recent match first.
router.get('/:id/messages/search', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const q = (req.query.q || '').trim();

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }
  if (!q) {
    return res.json({ messages: [] });
  }

  const matches = await prisma.message.findMany({
    where: { conversationId: id, deletedAt: null, text: { contains: q, mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { sender: { select: { id: true, name: true } } },
  });

  res.json({
    messages: matches.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: m.sender?.name || null,
      text: m.text,
      createdAt: m.createdAt,
    })),
  });
}));

// Edit the text of your own message.
router.patch('/:id/messages/:messageId', requireAuth, asyncHandler(async (req, res) => {
  const { id, messageId } = req.params;
  const { text } = req.body;

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  const existing = await prisma.message.findUnique({ where: { id: messageId } });
  if (!existing || existing.conversationId !== id) {
    return res.status(404).json({ error: 'Message not found' });
  }
  if (existing.senderId !== req.userId) {
    return res.status(403).json({ error: 'You can only edit your own messages' });
  }
  if (existing.deletedAt) {
    return res.status(400).json({ error: 'Cannot edit a deleted message' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { text: text.trim(), editedAt: new Date() },
    include: { sender: MESSAGE_SENDER_INCLUDE, ...REPLY_PREVIEW_INCLUDE, ...REACTIONS_INCLUDE },
  });

  const message = serializeMessage(updated);
  getIo()?.to(`conversation:${id}`).emit('message:updated', message);
  res.json({ message });
}));

// Soft-delete your own message; other participants see a "message deleted" placeholder.
router.delete('/:id/messages/:messageId', requireAuth, asyncHandler(async (req, res) => {
  const { id, messageId } = req.params;

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  const existing = await prisma.message.findUnique({ where: { id: messageId } });
  if (!existing || existing.conversationId !== id) {
    return res.status(404).json({ error: 'Message not found' });
  }
  if (existing.senderId !== req.userId) {
    return res.status(403).json({ error: 'You can only delete your own messages' });
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
    include: { sender: MESSAGE_SENDER_INCLUDE, ...REPLY_PREVIEW_INCLUDE, ...REACTIONS_INCLUDE },
  });

  const message = serializeMessage(updated);
  getIo()?.to(`conversation:${id}`).emit('message:deleted', message);
  res.json({ message });
}));

// Toggle a reaction: adding it if the current user hasn't reacted with this exact emoji
// on this message yet, removing it if they have. Broadcast as message:updated (rather than
// a bespoke event) since the frontend already knows how to patch a message in place.
router.post('/:id/messages/:messageId/reactions', requireAuth, asyncHandler(async (req, res) => {
  const { id, messageId } = req.params;
  const { emoji } = req.body;

  const membership = await requireMembership(id, req.userId);
  if (!membership) {
    return res.status(403).json({ error: 'Not a participant of this conversation' });
  }

  const existing = await prisma.message.findUnique({ where: { id: messageId } });
  if (!existing || existing.conversationId !== id) {
    return res.status(404).json({ error: 'Message not found' });
  }
  if (existing.deletedAt) {
    return res.status(400).json({ error: 'Cannot react to a deleted message' });
  }
  if (!emoji || typeof emoji !== 'string' || !emoji.trim()) {
    return res.status(400).json({ error: 'emoji is required' });
  }
  const trimmedEmoji = emoji.trim().slice(0, 8);

  const existingReaction = await prisma.reaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: req.userId, emoji: trimmedEmoji } },
  });

  if (existingReaction) {
    await prisma.reaction.delete({ where: { id: existingReaction.id } });
  } else {
    await prisma.reaction.create({ data: { messageId, userId: req.userId, emoji: trimmedEmoji } });
  }

  const updated = await prisma.message.findUnique({
    where: { id: messageId },
    include: { sender: MESSAGE_SENDER_INCLUDE, ...REPLY_PREVIEW_INCLUDE, ...REACTIONS_INCLUDE },
  });

  const message = serializeMessage(updated);
  getIo()?.to(`conversation:${id}`).emit('message:updated', message);
  res.json({ message });
}));

module.exports = router;
