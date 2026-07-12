const express = require('express');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');
const { getIo } = require('../socket');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

const PUBLIC_USER_FIELDS = { id: true, username: true, name: true, avatarUrl: true };
// Returned to the profile owner (own editable fields) after a PATCH /me.
const SELF_FIELDS = { id: true, username: true, name: true, avatarUrl: true, bio: true, status: true };
// Returned when viewing anyone's profile — adds "last seen" so the viewer can see
// when they were online, mirroring the header of a 1-1 chat.
const PROFILE_FIELDS = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
  bio: true,
  status: true,
  lastSeenAt: true,
};

const BIO_MAX = 280;
const STATUS_MAX = 100;
const NAME_MAX = 80;

// Search users strictly by username (never by email/name), and only when a query is given.
// This intentionally does not support browsing the full user directory.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const raw = (req.query.search || '').trim();
  const query = raw.replace(/^@/, '');

  if (!query) {
    return res.json({ users: [] });
  }

  // Hide anyone on either side of a block from search — no point surfacing someone you
  // can't actually start a conversation with (see the block check in message:send).
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: req.userId }, { blockedId: req.userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const excludedIds = [req.userId, ...blocks.flatMap((b) => [b.blockerId, b.blockedId])];

  // Usernames are always stored lowercase (enforced at registration), so a plain
  // startsWith on the lowercased query is already case-insensitive without needing
  // Prisma's `mode: 'insensitive'` (which isn't supported on every datasource).
  const users = await prisma.user.findMany({
    where: {
      id: { notIn: excludedIds },
      username: { startsWith: query.toLowerCase() },
    },
    select: PUBLIC_USER_FIELDS,
    take: 20,
  });

  res.json({ users });
}));

// Update the current user's own profile: avatar, display name, status and "about" (bio).
// Every field is optional — only the keys present in the body are touched — so the same
// endpoint serves the avatar-only flow and the profile editor.
router.patch('/me', requireAuth, asyncHandler(async (req, res) => {
  const { avatarUrl, name, status, bio } = req.body;
  const data = {};

  if (avatarUrl !== undefined) {
    if (avatarUrl !== null && typeof avatarUrl !== 'string') {
      return res.status(400).json({ error: 'avatarUrl must be a string' });
    }
    data.avatarUrl = avatarUrl || null;
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name must be a non-empty string' });
    }
    data.name = name.trim().slice(0, NAME_MAX);
  }

  // status/bio accept a string (trimmed, length-capped) or an empty string / null to clear.
  if (status !== undefined) {
    if (status !== null && typeof status !== 'string') {
      return res.status(400).json({ error: 'status must be a string' });
    }
    const trimmed = (status || '').trim();
    data.status = trimmed ? trimmed.slice(0, STATUS_MAX) : null;
  }

  if (bio !== undefined) {
    if (bio !== null && typeof bio !== 'string') {
      return res.status(400).json({ error: 'bio must be a string' });
    }
    const trimmed = (bio || '').trim();
    data.bio = trimmed ? trimmed.slice(0, BIO_MAX) : null;
  }

  const user = await prisma.user.update({
    where: { id: req.userId },
    data,
    select: SELF_FIELDS,
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

// Block another user: neither of you can message the other in your 1-1 chat any more (see
// the block check in socket message:send), and they stop showing up in your search results.
router.post('/:id/block', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (id === req.userId) {
    return res.status(400).json({ error: "Can't block yourself" });
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  await prisma.block.upsert({
    where: { blockerId_blockedId: { blockerId: req.userId, blockedId: id } },
    create: { blockerId: req.userId, blockedId: id },
    update: {},
  });

  res.json({ ok: true });
}));

router.delete('/:id/block', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  await prisma.block.deleteMany({ where: { blockerId: req.userId, blockedId: id } });
  res.json({ ok: true });
}));

// Files a report against a user for later manual review — no automated action is taken.
router.post('/:id/report', requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (id === req.userId) {
    return res.status(400).json({ error: "Can't report yourself" });
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) {
    return res.status(404).json({ error: 'User not found' });
  }

  await prisma.report.create({
    data: {
      reporterId: req.userId,
      reportedId: id,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null,
    },
  });

  res.json({ ok: true });
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

// Public profile of any user by id — powers the "view someone's profile" modal, so it
// includes lastSeenAt. Defined last so the more specific /:id/block, /:id/report and
// /by-username/:username routes above take precedence.
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: PROFILE_FIELDS,
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ user });
}));

module.exports = router;
