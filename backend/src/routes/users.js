const express = require('express');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { getIo } = require('../socket');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

const PUBLIC_USER_FIELDS = { id: true, username: true, name: true, avatarUrl: true };

// Search users strictly by username (never by email/name), and only when a query is given.
// This intentionally does not support browsing the full user directory.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const raw = (req.query.search || '').trim();
  const query = raw.replace(/^@/, '');

  if (!query) {
    return res.json({ users: [] });
  }

  // Usernames are always stored lowercase (enforced at registration), so a plain
  // startsWith on the lowercased query is already case-insensitive without needing
  // Prisma's `mode: 'insensitive'` (which isn't supported on every datasource).
  const users = await prisma.user.findMany({
    where: {
      id: { not: req.userId },
      username: { startsWith: query.toLowerCase() },
    },
    select: PUBLIC_USER_FIELDS,
    take: 20,
  });

  res.json({ users });
}));

// Update the current user's own profile (currently just the avatar).
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const { avatarUrl } = req.body;

  if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== 'string') {
    return res.status(400).json({ error: 'avatarUrl must be a string' });
  }

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { avatarUrl: avatarUrl || null },
    select: PUBLIC_USER_FIELDS,
  });

  // Without this, everyone already sharing a conversation with this user only sees their
  // new avatar after their next reload — the participant list embedded in each open chat
  // is a snapshot from whenever it was last fetched.
  const memberships = await prisma.conversationParticipant.findMany({
    where: { userId: req.userId },
    select: { conversationId: true },
  });
  const io = getIo();
  memberships.forEach((m) => {
    io?.to(`conversation:${m.conversationId}`).emit('conversation:updated', { conversationId: m.conversationId });
  });

  res.json({ user });
}));

// Exact lookup used to resolve a shared profile link (/u/:username).
router.get('/by-username/:username', requireAuth, asyncHandler(async (req, res) => {
  const username = req.params.username.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { username },
    select: PUBLIC_USER_FIELDS,
  });

  if (!user || user.id === req.userId) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user });
}));

module.exports = router;
