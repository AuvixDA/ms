// Shared between the REST routes and the socket handler so a message looks identical
// whether it arrived via GET /conversations/:id/messages or a live message:new/updated event.

// A lightweight preview of a message being replied to — just enough to render a quote
// strip, not the full message shape (no point recursing into its own replyTo, etc).
function serializeReplyPreview(m) {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    senderId: m.senderId,
    senderName: m.sender?.name || null,
    text: deleted ? null : m.text,
    fileName: deleted ? null : m.fileName,
    deleted,
  };
}

function serializeMessage(m) {
  const deleted = !!m.deletedAt;
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    sender: m.sender,
    text: deleted ? null : m.text,
    fileUrl: deleted ? null : m.fileUrl,
    fileName: deleted ? null : m.fileName,
    replyTo: m.replyTo ? serializeReplyPreview(m.replyTo) : null,
    forwardedFromName: deleted ? null : m.forwardedFromName || null,
    reactions: deleted
      ? []
      : (m.reactions || []).map((r) => ({ emoji: r.emoji, userId: r.userId, userName: r.user?.name || null })),
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
  };
}

const MESSAGE_SENDER_INCLUDE = { select: { id: true, name: true, avatarUrl: true } };

const REPLY_PREVIEW_INCLUDE = {
  replyTo: { include: { sender: { select: { id: true, name: true } } } },
};

const REACTIONS_INCLUDE = {
  reactions: { include: { user: { select: { id: true, name: true } } } },
};

module.exports = { serializeMessage, MESSAGE_SENDER_INCLUDE, REPLY_PREVIEW_INCLUDE, REACTIONS_INCLUDE };
