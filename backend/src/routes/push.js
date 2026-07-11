const express = require('express');
const prisma = require('../prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.post('/subscribe', requireAuth, async (req, res) => {
  const { endpoint, keys } = req.body;

  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { userId: req.userId, p256dh: keys.p256dh, auth: keys.auth },
    create: { userId: req.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });

  res.status(201).json({ ok: true });
});

router.post('/unsubscribe', requireAuth, async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });

  await prisma.pushSubscription.delete({ where: { endpoint } }).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
