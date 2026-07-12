const express = require('express');
const dns = require('dns').promises;
const net = require('net');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 2 * 1024 * 1024; // stop reading an HTML response past 2MB
const MAX_REDIRECTS = 3;

// Blocks loopback/private/link-local/reserved ranges so a message containing e.g.
// http://169.254.169.254/ (cloud metadata) or http://localhost:4000/admin can't be used
// to make this server fetch its own internal network on the sender's behalf.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.split(':').pop();
      if (net.isIPv4(v4)) return isPrivateIp(v4);
    }
    return false;
  }
  return true; // unrecognized format — fail closed
}

// Resolves the hostname ourselves and checks every returned address, rather than trusting
// fetch() to do it — this is what actually stops DNS-rebinding (a public hostname that
// resolves to a private IP) rather than just literal http://127.0.0.1 links.
async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Blocked host');
    return;
  }
  const records = await dns.lookup(hostname, { all: true });
  if (records.length === 0) throw new Error('Could not resolve host');
  records.forEach((r) => {
    if (isPrivateIp(r.address)) throw new Error('Blocked host');
  });
}

// Redirects are followed manually (not via fetch's own redirect:'follow') so each hop gets
// the same public-host check — otherwise a public URL could 302 straight to an internal one.
async function fetchWithSsrfGuard(targetUrl, redirectsLeft) {
  const parsed = new URL(targetUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Unsupported protocol');
  }
  await assertPublicHost(parsed.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(parsed.toString(), {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MessengerLinkPreview/1.0)' },
    });
  } finally {
    clearTimeout(timeout);
  }

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    if (redirectsLeft <= 0) throw new Error('Too many redirects');
    const location = res.headers.get('location');
    if (!location) throw new Error('Redirect with no location');
    return fetchWithSsrfGuard(new URL(location, parsed).toString(), redirectsLeft - 1);
  }
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    throw new Error('Not HTML');
  }

  const chunks = [];
  let received = 0;
  const reader = res.body?.getReader();
  if (reader) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      chunks.push(value);
      if (received > MAX_BYTES) {
        reader.cancel();
        break;
      }
    }
  }
  const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  return { html, finalUrl: parsed.toString() };
}

function extractMetaProperty(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*property=["']${property}["']`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractMetaName(html, name) {
  const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// GET /link-preview?url=... — fetches Open Graph data for a link found in a message.
// Requires auth so this can't be used as an open SSRF probe by anonymous callers.
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const { html, finalUrl } = await fetchWithSsrfGuard(parsed.toString(), MAX_REDIRECTS);

    const titleTag = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1];
    const title = extractMetaProperty(html, 'og:title') || titleTag || null;
    const description = extractMetaProperty(html, 'og:description') || extractMetaName(html, 'description');
    const siteName = extractMetaProperty(html, 'og:site_name');
    let image = extractMetaProperty(html, 'og:image');
    if (image) {
      try {
        image = new URL(image, finalUrl).toString();
      } catch {
        image = null;
      }
    }

    res.json({
      url: finalUrl,
      title: title ? decodeEntities(title).trim().slice(0, 200) : null,
      description: description ? decodeEntities(description).trim().slice(0, 300) : null,
      image,
      siteName: siteName ? decodeEntities(siteName).trim().slice(0, 100) : null,
    });
  } catch (err) {
    res.status(422).json({ error: 'Could not load preview' });
  }
}));

module.exports = router;
