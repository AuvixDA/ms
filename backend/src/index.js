require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const conversationRoutes = require('./routes/conversations');
const uploadRoutes = require('./routes/upload');
const pushRoutes = require('./routes/push');
const linkPreviewRoutes = require('./routes/linkPreview');
const { initSocket } = require('./socket');
const { configure: configurePush } = require('./push');

const app = express();
const server = http.createServer(app);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/conversations', conversationRoutes);
app.use('/upload', uploadRoutes);
app.use('/push', pushRoutes);
app.use('/link-preview', linkPreviewRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

// Catches errors forwarded via next(err) from asyncHandler-wrapped routes, so a
// failed request returns a 500 instead of crashing the whole process.
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

configurePush();
initSocket(server, FRONTEND_ORIGIN);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
