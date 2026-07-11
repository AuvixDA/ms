const webpush = require('web-push');
const prisma = require('./prisma');

let configured = false;

function configure() {
  if (configured) return;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID keys not set — push notifications are disabled');
    return;
  }
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

async function notifyUser(userId, payload) {
  configure();
  if (!configured) return;

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });

  await Promise.all(
    subscriptions.map(async (sub) => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
        } else {
          console.error('[push] send failed', err.message);
        }
      }
    })
  );
}

module.exports = { configure, notifyUser };
