import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  Ban,
  Bookmark,
  Check,
  CheckCheck,
  CheckSquare,
  Clock,
  Copy,
  FileIcon,
  Flag,
  Forward,
  Loader2,
  MoreVertical,
  Paperclip,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Reply,
  Search,
  Send,
  Settings,
  SmilePlus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api, resolveFileUrl } from '../api/client';
import { connectSocket } from '../socket';
import Avatar from './Avatar';
import ForwardModal from './ForwardModal';
import GroupInfoModal from './GroupInfoModal';
import Lightbox from './Lightbox';
import LinkPreview from './LinkPreview';
import UserProfileModal from './UserProfileModal';
import { formatLastSeen } from '../format';

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif)$/i;
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const WALLPAPER_KEY = 'chatWallpaper';
const WALLPAPER_PRESETS = [
  { id: 'none', label: 'Без фона', swatch: 'transparent' },
  { id: 'violet', label: 'Фиолетовый', swatch: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' },
  { id: 'ocean', label: 'Океан', swatch: 'linear-gradient(135deg, #22d3ee, #3b82f6)' },
  { id: 'sunset', label: 'Закат', swatch: 'linear-gradient(135deg, #ec4899, #f59e0b)' },
  { id: 'dots', label: 'Точки', swatch: 'radial-gradient(circle, #8b5cf6 1.4px, transparent 1.4px) 0 0 / 9px 9px' },
];

function groupReactions(reactions, currentUserId) {
  const order = [];
  const byEmoji = new Map();
  (reactions || []).forEach((r) => {
    if (!byEmoji.has(r.emoji)) {
      byEmoji.set(r.emoji, []);
      order.push(r.emoji);
    }
    byEmoji.get(r.emoji).push(r);
  });
  return order.map((emoji) => {
    const list = byEmoji.get(emoji);
    return { emoji, count: list.length, mine: list.some((r) => r.userId === currentUserId) };
  });
}

const URL_PATTERN = /https?:\/\/[^\s<]+[^\s<.,:;"')\]]/;

// Only the first link gets a preview card, same as most messengers — a message with
// several URLs would otherwise turn into a wall of preview cards.
function extractFirstUrl(text) {
  if (!text) return null;
  const match = text.match(URL_PATTERN);
  return match ? match[0] : null;
}

// Mentions are stored as userIds (see backend/src/socket/index.js), not text — so
// highlighting them means matching "@username" substrings back against each mentioned
// user's *current* username, resolved fresh from the conversation's own participant list
// every render. A username that changed after the message was sent just won't highlight
// anymore, but the underlying mention (used for notifications) is unaffected either way.
function renderMessageText(text, mentionedIds, participants, currentUserId, currentUsername) {
  if (!mentionedIds || mentionedIds.length === 0) return text;
  const usernameById = new Map(participants.map((p) => [p.id, p.username]));
  if (currentUsername) usernameById.set(currentUserId, currentUsername);
  const mentionedUsernames = new Set(
    mentionedIds.map((uid) => usernameById.get(uid)).filter(Boolean).map((u) => u.toLowerCase())
  );
  if (mentionedUsernames.size === 0) return text;

  const pattern = /@([a-zA-Z0-9_]{3,20})/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (!mentionedUsernames.has(match[1].toLowerCase())) continue;
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <span key={match.index} className="font-semibold text-cyan-300">
        {match[0]}
      </span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (parts.length === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

// In a group, name the people typing (Telegram-style); in a 1-1 chat the other person is
// the only one who could be typing, so a name would be redundant.
function typingLabel(typingUsers, conversation) {
  if (typingUsers.size === 0) return null;
  if (!conversation?.isGroup) return 'печатает...';
  const names = conversation.participants
    .filter((p) => typingUsers.has(p.id))
    .map((p) => p.name || p.username);
  if (names.length === 0) return 'печатает...';
  if (names.length === 1) return `${names[0]} печатает...`;
  if (names.length === 2) return `${names[0]} и ${names[1]} печатают...`;
  return `${names.length} человек печатают...`;
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function conversationTitle(conversation) {
  if (!conversation) return '';
  if (conversation.isSelf) return 'Избранное';
  if (conversation.isGroup) return conversation.name || 'Группа';
  const other = conversation.participants[0];
  if (!other) return 'Пользователь';
  return other.name || (other.username ? `@${other.username}` : 'Пользователь');
}

// A message counts as "read" once every other participant's last-read timestamp is at
// or past when it was sent. Delivery is otherwise assumed as soon as it's in local state,
// since it only reaches there after the server has persisted and broadcast it.
function isReadByOthers(message, conversation) {
  if (!conversation?.participants?.length) return false;
  return conversation.participants.every(
    (p) => p.lastReadAt && new Date(p.lastReadAt) >= new Date(message.createdAt)
  );
}

// Per-participant breakdown behind the group "read by" popover — same lastReadAt data
// isReadByOthers already collapses into a single yes/no.
function readReceipts(message, conversation) {
  const read = [];
  const unread = [];
  (conversation?.participants || []).forEach((p) => {
    if (p.lastReadAt && new Date(p.lastReadAt) >= new Date(message.createdAt)) read.push(p);
    else unread.push(p);
  });
  return { read, unread };
}

export default function ChatWindow({ conversationId, currentUserId, currentUsername, onOpenSidebar, draft, onDraftChange }) {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // Seeded once from the parent's per-chat draft store on mount — ChatWindow remounts on
  // conversationId change (see the `key` prop in ChatPage), so this always picks up the
  // right chat's draft without needing to resync later.
  const [text, setText] = useState(draft || '');
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [profileUserId, setProfileUserId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionRange, setMentionRange] = useState(null);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [presence, setPresence] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const [readByFor, setReadByFor] = useState(null);
  const [mobileActionsFor, setMobileActionsFor] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [wallpaper, setWallpaper] = useState(() => localStorage.getItem(WALLPAPER_KEY) || 'none');
  const [wallpaperMenuOpen, setWallpaperMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const searchTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
  const initialLoadIdsRef = useRef(new Set());
  const skipScrollAnimationRef = useRef(true);
  const dragCounterRef = useRef(0);
  // tempId -> { text, fileUrl, fileName, timeoutId }, for messages sent optimistically and
  // not yet confirmed by the server (via ack or the message:new broadcast, whichever wins).
  const pendingSendsRef = useRef(new Map());
  // The self lastReadAt from the moment this chat was opened, captured once before markRead()
  // races ahead and advances it — this is the boundary the "unread messages" divider renders
  // above. boundaryCapturedRef guards against later conversation:updated refreshes (which
  // would otherwise carry an already-advanced lastReadAt) overwriting it mid-session.
  const unreadBoundaryRef = useRef(null);
  const boundaryCapturedRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const navigate = useNavigate();

  function loadConversation() {
    api.getConversation(conversationId).then((data) => {
      setConversation(data.conversation);
      if (!boundaryCapturedRef.current) {
        boundaryCapturedRef.current = true;
        unreadBoundaryRef.current = data.conversation.lastReadAt;
      }
    });
  }

  function markRead() {
    api.markConversationRead(conversationId).catch(() => {});
  }

  useEffect(() => {
    setMessages([]);
    setConversation(null);
    setHasMore(false);
    setEditingId(null);
    setReplyingTo(null);
    setPendingAttachment((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setViewingHistory(false);
    shouldStickToBottomRef.current = true;
    skipScrollAnimationRef.current = true;
    boundaryCapturedRef.current = false;
    unreadBoundaryRef.current = null;

    api.getMessages(conversationId).then((data) => {
      initialLoadIdsRef.current = new Set(data.messages.map((m) => m.id));
      setMessages(data.messages);
      setHasMore(data.hasMore);
      markRead();
    });
    loadConversation();

    const socket = connectSocket();
    socket.emit('conversation:join', { conversationId });

    // Let the server know this chat is open in the foreground, so it can skip push
    // notifications for it — but only while the tab itself is actually visible; a chat
    // left open in a backgrounded tab should still notify.
    function syncActiveState() {
      socket.emit(document.visibilityState === 'visible' ? 'conversation:active' : 'conversation:inactive', {
        conversationId,
      });
    }
    syncActiveState();
    document.addEventListener('visibilitychange', syncActiveState);

    function handleNewMessage(message) {
      if (message.conversationId !== conversationId) return;
      // If this is our own message, it may be the server confirming a pending optimistic
      // bubble from this exact tab — resolve that one in place instead of appending a
      // second copy. (A different tab/device of ours sending it has no matching pending
      // entry here, so it falls through to a normal append, as it should.)
      if (message.senderId === currentUserId) {
        for (const [tempId, entry] of pendingSendsRef.current) {
          if (entry.text === message.text && entry.fileUrl === message.fileUrl && entry.fileName === message.fileName) {
            clearTimeout(entry.timeoutId);
            pendingSendsRef.current.delete(tempId);
            setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...message, clientId: tempId } : m)));
            return;
          }
        }
      }
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      if (message.senderId !== currentUserId) markRead();
    }

    function handleMessageUpdated(message) {
      if (message.conversationId !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    }

    function handleMessageDeleted(message) {
      if (message.conversationId !== conversationId) return;
      setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    }

    function handleTyping({ conversationId: cid, userId, isTyping }) {
      if (cid !== conversationId || userId === currentUserId) return;
      setTypingUsers((prev) => {
        const next = new Set(prev);
        if (isTyping) next.add(userId);
        else next.delete(userId);
        return next;
      });
    }

    function handleConversationUpdated({ conversationId: cid }) {
      if (cid !== conversationId) return;
      loadConversation();
    }

    function handleConversationRemoved({ conversationId: cid, userId }) {
      if (cid !== conversationId || userId !== currentUserId) return;
      navigate('/', { replace: true });
    }

    function handleConversationRead({ conversationId: cid, userId, readAt }) {
      if (cid !== conversationId) return;
      setConversation((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          participants: prev.participants.map((p) => (p.id === userId ? { ...p, lastReadAt: readAt } : p)),
        };
      });
    }

    function handleConversationPin({ conversationId: cid, pinnedMessage }) {
      if (cid !== conversationId) return;
      setConversation((prev) => (prev ? { ...prev, pinnedMessage } : prev));
    }

    socket.on('message:new', handleNewMessage);
    socket.on('message:updated', handleMessageUpdated);
    socket.on('message:deleted', handleMessageDeleted);
    socket.on('typing', handleTyping);
    socket.on('conversation:updated', handleConversationUpdated);
    socket.on('conversation:removed', handleConversationRemoved);
    socket.on('conversation:read', handleConversationRead);
    socket.on('conversation:pin', handleConversationPin);
    return () => {
      socket.emit('conversation:inactive', { conversationId });
      document.removeEventListener('visibilitychange', syncActiveState);
      socket.off('message:new', handleNewMessage);
      socket.off('message:updated', handleMessageUpdated);
      socket.off('message:deleted', handleMessageDeleted);
      socket.off('typing', handleTyping);
      socket.off('conversation:updated', handleConversationUpdated);
      socket.off('conversation:removed', handleConversationRemoved);
      socket.off('conversation:read', handleConversationRead);
      socket.off('conversation:pin', handleConversationPin);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, currentUserId]);

  const otherParticipantId = !conversation?.isGroup ? conversation?.participants?.[0]?.id : null;

  // Presence (online / "last seen") for the other side of a 1-1 chat. Queried once the
  // conversation loads (so it's correct even if this socket only just connected), then
  // kept live via the same presence:update broadcast the chat list uses for its dot.
  useEffect(() => {
    if (!otherParticipantId) {
      setPresence(null);
      return;
    }
    const socket = connectSocket();
    socket.emit('presence:query', { userIds: [otherParticipantId] }, (result) => {
      if (result?.[otherParticipantId]) setPresence(result[otherParticipantId]);
    });

    function handlePresenceUpdate({ userId, online, lastSeenAt }) {
      if (userId !== otherParticipantId) return;
      setPresence({ online, lastSeenAt: lastSeenAt ?? null });
    }

    socket.on('presence:update', handlePresenceUpdate);
    return () => socket.off('presence:update', handlePresenceUpdate);
  }, [otherParticipantId]);

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: skipScrollAnimationRef.current ? 'auto' : 'smooth' });
    }
    skipScrollAnimationRef.current = false;
  }, [messages]);

  useEffect(() => {
    if (!reactionPickerFor) return;
    function handleClickOutside(e) {
      if (!e.target.closest('[data-reaction-picker]')) setReactionPickerFor(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [reactionPickerFor]);

  useEffect(() => {
    if (!readByFor) return;
    function handleClickOutside(e) {
      if (!e.target.closest('[data-readby-picker]')) setReadByFor(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [readByFor]);

  useEffect(() => {
    if (!wallpaperMenuOpen) return;
    function handleClickOutside(e) {
      if (!e.target.closest('[data-wallpaper-picker]')) setWallpaperMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [wallpaperMenuOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handleClickOutside(e) {
      if (!e.target.closest('[data-user-menu]')) setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen]);

  function selectWallpaper(id) {
    setWallpaper(id);
    localStorage.setItem(WALLPAPER_KEY, id);
    setWallpaperMenuOpen(false);
  }

  async function loadOlderMessages() {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    const container = scrollRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;
    try {
      const data = await api.getMessages(conversationId, messages[0].id);
      data.messages.forEach((m) => initialLoadIdsRef.current.add(m.id));
      shouldStickToBottomRef.current = false;
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight;
        }
      });
    } finally {
      setLoadingMore(false);
    }
  }

  function handleScroll(e) {
    const el = e.target;
    shouldStickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60) {
      loadOlderMessages();
    }
  }

  function emitTyping(isTyping) {
    connectSocket().emit('typing', { conversationId, isTyping });
  }

  // Grows the textarea with its content up to a max height, then scrolls internally.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);

  // Mirrors the in-progress text up to ChatPage's per-chat draft store on every keystroke,
  // so switching chats (or reloading the page) doesn't lose what was being typed.
  useEffect(() => {
    onDraftChange?.(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  function handleTextChange(e) {
    const value = e.target.value;
    setText(value);
    emitTyping(true);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => emitTyping(false), 1500);
    updateMentionQuery(value, e.target.selectionStart);
  }

  // @mentions only make sense with a fixed set of people to mention, so this only ever
  // triggers in groups — a 1-1 chat has nobody else to autocomplete against.
  function updateMentionQuery(value, cursor) {
    if (!conversation?.isGroup) {
      setMentionQuery(null);
      return;
    }
    const uptoCursor = value.slice(0, cursor);
    const atIndex = uptoCursor.lastIndexOf('@');
    if (atIndex === -1) {
      setMentionQuery(null);
      return;
    }
    const fragment = uptoCursor.slice(atIndex + 1);
    const boundaryOk = atIndex === 0 || /\s/.test(uptoCursor[atIndex - 1]);
    if (!boundaryOk || !/^[a-zA-Z0-9_]{0,20}$/.test(fragment)) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(fragment);
    setMentionRange({ start: atIndex, end: cursor });
  }

  const mentionCandidates =
    mentionQuery !== null
      ? (conversation?.participants || [])
          .filter((p) => p.username?.toLowerCase().startsWith(mentionQuery.toLowerCase()))
          .slice(0, 5)
      : [];

  function selectMention(participant) {
    const insertion = `@${participant.username} `;
    const newText = text.slice(0, mentionRange.start) + insertion + text.slice(mentionRange.end);
    setText(newText);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = mentionRange.start + insertion.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  // Enter sends the message; Shift+Enter (or Ctrl/Cmd+Enter) inserts a newline like most
  // chat apps, so people can write multi-paragraph messages without them being cut off.
  // While the mention dropdown is open, Enter/Escape control it instead of sending.
  function handleKeyDown(e) {
    if (mentionQuery !== null && mentionCandidates.length > 0 && e.key === 'Enter') {
      e.preventDefault();
      selectMention(mentionCandidates[0]);
      return;
    }
    if (e.key === 'Escape' && mentionQuery !== null) {
      setMentionQuery(null);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Stages a file (from the file picker, a drag-and-drop, or a clipboard paste) instead of
  // uploading it immediately, so the user gets a preview and a chance to add a caption or
  // back out before it actually sends.
  function stageFile(file) {
    if (!file) return;
    setPendingAttachment((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return {
        file,
        name: file.name,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      };
    });
  }

  function cancelAttachment() {
    setPendingAttachment((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  function handleFileChange(e) {
    stageFile(e.target.files[0]);
    e.target.value = '';
  }

  function handlePaste(e) {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.kind === 'file');
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    stageFile(file);
  }

  // A plain dragenter/dragleave pair misfires while the pointer crosses child elements —
  // count enter/leave pairs so the "drop here" overlay only toggles at the container's edge.
  function handleDragEnter(e) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounterRef.current += 1;
    setIsDraggingFile(true);
  }

  function handleDragOver(e) {
    e.preventDefault();
  }

  function handleDragLeave(e) {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingFile(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingFile(false);
    stageFile(e.dataTransfer.files?.[0]);
  }

  // Shape shared with the backend's reply preview (see messageSerializer.js), used both
  // for the pending reply-bar above the input and for the optimistic message we render
  // immediately on send.
  function buildReplyContext(m) {
    return {
      id: m.id,
      senderId: m.senderId,
      senderName: m.sender?.name || (m.senderId === currentUserId ? 'Вы' : null),
      text: m.text,
      fileName: m.fileName,
      deleted: !!m.deletedAt,
    };
  }

  function scrollToMessage(id, behavior = 'smooth') {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return false;
    el.scrollIntoView({ behavior, block: 'center' });
    el.classList.add('ring-2', 'ring-neon-cyan/60');
    setTimeout(() => el.classList.remove('ring-2', 'ring-neon-cyan/60'), 1200);
    return true;
  }

  // Jumps to any message, even one far outside the currently loaded window (e.g. a search
  // result) — loads a fresh page of history centered on it if it isn't already on screen.
  async function jumpToMessage(id) {
    setSearchOpen(false);
    if (scrollToMessage(id, 'auto')) return;
    const data = await api.getMessagesAround(conversationId, id);
    initialLoadIdsRef.current = new Set(data.messages.map((m) => m.id));
    shouldStickToBottomRef.current = false;
    skipScrollAnimationRef.current = true;
    setMessages(data.messages);
    setHasMore(data.hasMore);
    setViewingHistory(data.hasNewer);
    requestAnimationFrame(() => scrollToMessage(id, 'auto'));
  }

  // Reloads the latest page, for the "back to latest" banner shown after jumping into
  // older history — cheaper and simpler than trying to stitch the two windows together.
  function jumpToLatest() {
    shouldStickToBottomRef.current = true;
    skipScrollAnimationRef.current = true;
    setViewingHistory(false);
    api.getMessages(conversationId).then((data) => {
      initialLoadIdsRef.current = new Set(data.messages.map((m) => m.id));
      setMessages(data.messages);
      setHasMore(data.hasMore);
    });
  }

  useEffect(() => {
    clearTimeout(searchTimeoutRef.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimeoutRef.current = setTimeout(() => {
      api
        .searchMessages(conversationId, searchQuery.trim())
        .then((data) => setSearchResults(data.messages))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(searchTimeoutRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, conversationId]);

  function markSendFailed(tempId) {
    const entry = pendingSendsRef.current.get(tempId);
    if (!entry) return; // already resolved (success or a previous failure) — nothing to do
    pendingSendsRef.current.delete(tempId);
    setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)));
  }

  // overrideText/overrideReplyTo let retrySend re-send a failed bubble's original content
  // without touching whatever the user currently has typed (or is replying to) right now.
  function sendMessage(fileUrl, fileName, overrideText, overrideReplyTo) {
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed && !fileUrl) return;
    shouldStickToBottomRef.current = true;

    const replyContext = overrideReplyTo !== undefined ? overrideReplyTo : replyingTo;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
      text: trimmed || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
      replyToId: replyContext?.id || null,
    };
    const optimisticMessage = {
      id: tempId,
      conversationId,
      senderId: currentUserId,
      sender: null,
      ...payload,
      replyTo: replyContext || null,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      status: 'sending',
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    const timeoutId = setTimeout(() => markSendFailed(tempId), 10000);
    pendingSendsRef.current.set(tempId, {
      text: payload.text,
      fileUrl: payload.fileUrl,
      fileName: payload.fileName,
      timeoutId,
    });

    connectSocket().emit('message:send', { conversationId, ...payload }, (response) => {
      const entry = pendingSendsRef.current.get(tempId);
      if (!entry) return; // the message:new broadcast already resolved this one
      clearTimeout(entry.timeoutId);
      pendingSendsRef.current.delete(tempId);
      if (response?.error) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, status: 'failed' } : m)));
      } else if (response?.message) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...response.message, clientId: tempId } : m)));
      }
    });

    if (overrideText === undefined) {
      setText('');
      setReplyingTo(null);
      setMentionQuery(null);
    }
    emitTyping(false);
  }

  function retrySend(message) {
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    sendMessage(message.fileUrl, message.fileName, message.text || '', message.replyTo || null);
  }

  async function handleSend() {
    if (!pendingAttachment) {
      sendMessage();
      return;
    }
    setUploading(true);
    try {
      const { fileUrl, fileName } = await api.uploadFile(pendingAttachment.file);
      cancelAttachment();
      sendMessage(fileUrl, fileName);
    } catch {
      // Leave the staged attachment and its preview in place so the user can just retry.
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    handleSend();
  }

  function startEdit(message) {
    setEditingId(message.id);
    setEditText(message.text || '');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
  }

  async function saveEdit(message) {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === message.text) {
      cancelEdit();
      return;
    }
    try {
      const { message: updated } = await api.editMessage(conversationId, message.id, trimmed);
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
    } finally {
      cancelEdit();
    }
  }

  async function handleDelete(message) {
    if (!window.confirm('Удалить сообщение?')) return;
    const { message: updated } = await api.deleteMessage(conversationId, message.id);
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  async function toggleReaction(message, emoji) {
    setReactionPickerFor(null);
    const { message: updated } = await api.toggleReaction(conversationId, message.id, emoji);
    setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
  }

  // Only one message can be pinned at a time — pinning a different one silently replaces
  // whatever was pinned before, both here and for every other participant (via conversation:pin).
  async function togglePin(message) {
    const isPinned = conversation?.pinnedMessage?.id === message.id;
    const { pinnedMessage } = isPinned
      ? await api.unpinMessage(conversationId)
      : await api.pinMessage(conversationId, message.id);
    setConversation((prev) => (prev ? { ...prev, pinnedMessage } : prev));
  }

  async function handleToggleBlock() {
    setUserMenuOpen(false);
    if (!other) return;
    if (conversation?.blockedByMe) {
      await api.unblockUser(other.id);
    } else {
      if (!window.confirm(`Заблокировать ${other.name || 'пользователя'}? Вы больше не сможете писать друг другу.`)) {
        return;
      }
      await api.blockUser(other.id);
    }
    loadConversation();
  }

  async function handleReport() {
    setUserMenuOpen(false);
    if (!other) return;
    const reason = window.prompt(`Пожаловаться на ${other.name || 'пользователя'}. Причина (необязательно):`);
    if (reason === null) return;
    await api.reportUser(other.id, reason);
    window.alert('Жалоба отправлена.');
  }

  // Touch devices have no hover, so the desktop reply/forward/react bar is unreachable there —
  // a long-press on the bubble opens the same actions as a bottom sheet instead. The 450ms
  // hold-to-trigger mirrors native messenger long-press timing.
  function handleBubbleTouchStart(m, deleted, pending, editing) {
    if (deleted || pending || editing) return;
    longPressTriggeredRef.current = false;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (navigator.vibrate) navigator.vibrate(10);
      setMobileActionsFor(m);
    }, 450);
  }

  function cancelBubbleLongPress() {
    clearTimeout(longPressTimerRef.current);
  }

  // Swallows the synthetic click that follows touchend right after a long-press fired, so
  // e.g. tapping an image bubble doesn't also open the lightbox behind the action sheet.
  function suppressPostLongPressClick(e) {
    if (longPressTriggeredRef.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressTriggeredRef.current = false;
    }
  }

  function enterSelectionMode(messageId) {
    setMobileActionsFor(null);
    setSelectionMode(true);
    setSelectedIds(new Set([messageId]));
  }

  function toggleSelected(messageId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  const selectedMessages = messages.filter((m) => selectedIds.has(m.id));
  // Deleting someone else's message always 403s server-side — hide the option entirely
  // rather than let people select a mixed batch and have it partially fail.
  const canDeleteSelection = selectedMessages.length > 0 && selectedMessages.every((m) => m.senderId === currentUserId);

  async function handleBulkDelete() {
    if (!canDeleteSelection) return;
    if (!window.confirm(`Удалить ${selectedMessages.length} сообщений?`)) return;
    const ids = [...selectedIds];
    exitSelectionMode();
    await Promise.all(
      ids.map(async (id) => {
        const { message: updated } = await api.deleteMessage(conversationId, id);
        setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      })
    );
  }

  function handleBulkForward() {
    if (selectedMessages.length === 0) return;
    setForwardingMessage(selectedMessages);
    exitSelectionMode();
  }

  function openBubbleContextMenu(e, m, deleted, pending, editing) {
    // Always suppress the browser's own right-click menu on a message bubble — even when
    // there's nothing for our own menu to show (deleted/pending/editing), the native
    // "View page source / Save image as" menu looks broken there, not just unwanted.
    e.preventDefault();
    if (deleted || pending || editing) return;
    setMobileActionsFor(m);
  }

  const other = !conversation?.isGroup ? conversation?.participants[0] : null;

  return (
    <div
      className="flex-1 flex flex-col h-full min-w-0 relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDraggingFile && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-950/80 backdrop-blur-sm border-2 border-dashed border-neon-cyan/60 m-2 rounded-2xl pointer-events-none animate-fade-in">
          <div className="flex flex-col items-center gap-2 text-cyan-300">
            <Upload size={32} />
            <p className="text-sm font-medium">Отпустите файл, чтобы прикрепить</p>
          </div>
        </div>
      )}
      <div className="glass-panel border-x-0 border-t-0 px-4 py-3 flex items-center gap-3 shrink-0">
        {selectionMode ? (
          <>
            <button
              onClick={exitSelectionMode}
              className="icon-btn p-2 -ml-2 rounded-full transition-all duration-300 shrink-0"
              title="Отменить выбор"
            >
              <X size={19} />
            </button>
            <p className="flex-1 font-medium text-white/90">Выбрано: {selectedIds.size}</p>
            <button
              onClick={handleBulkForward}
              disabled={selectedIds.size === 0}
              className="icon-btn p-2 rounded-full transition-all duration-300 shrink-0 disabled:opacity-30"
              title="Переслать выбранные"
            >
              <Forward size={18} />
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={!canDeleteSelection}
              className="icon-btn p-2 rounded-full transition-all duration-300 shrink-0 disabled:opacity-30 hover:text-rose-400"
              title={canDeleteSelection ? 'Удалить выбранные' : 'Можно удалить только свои сообщения'}
            >
              <Trash2 size={18} />
            </button>
          </>
        ) : (
          <>
        <button
          onClick={onOpenSidebar}
          className="icon-btn p-2 -ml-2 rounded-full transition-all duration-300 md:hidden shrink-0"
          title="К списку чатов"
        >
          <ArrowLeft size={19} />
        </button>
        {conversation?.isSelf ? (
          <Avatar name={conversationTitle(conversation)} size="sm" icon={<Bookmark size={16} />} />
        ) : conversation?.isGroup ? (
          <Avatar name={conversationTitle(conversation)} src={conversation.avatarUrl} size="sm" />
        ) : (
          <button
            type="button"
            onClick={() => other?.id && setProfileUserId(other.id)}
            className="shrink-0 rounded-full transition-transform duration-200 hover:brightness-110 active:scale-95"
            title="Открыть профиль"
          >
            <Avatar name={other?.name} src={other?.avatarUrl} size="sm" online={!!presence?.online} />
          </button>
        )}
        <div
          className={`min-w-0 flex-1 ${!conversation?.isGroup && !conversation?.isSelf ? 'cursor-pointer' : ''}`}
          onClick={
            !conversation?.isGroup && !conversation?.isSelf && other?.id
              ? () => setProfileUserId(other.id)
              : undefined
          }
        >
          <p className="font-medium text-white/90 truncate">{conversationTitle(conversation)}</p>
          {!conversation?.isGroup && !conversation?.isSelf && (
            <p className={`text-xs truncate ${presence?.online ? 'text-emerald-400' : 'text-white/40'}`}>
              {presence?.online
                ? 'в сети'
                : formatLastSeen(presence?.lastSeenAt) || (other?.username ? `@${other.username}` : '')}
            </p>
          )}
        </div>
        <button
          onClick={() => setSearchOpen((v) => !v)}
          className={`icon-btn p-2 rounded-full transition-all duration-300 shrink-0 ${searchOpen ? 'text-neon-cyan' : ''}`}
          title="Поиск по сообщениям"
        >
          <Search size={17} />
        </button>
        <div className="relative shrink-0" data-wallpaper-picker>
          <button
            onClick={() => setWallpaperMenuOpen((v) => !v)}
            className={`icon-btn p-2 rounded-full transition-all duration-300 ${wallpaperMenuOpen ? 'text-neon-cyan' : ''}`}
            title="Фон чата"
          >
            <Palette size={17} />
          </button>
          {wallpaperMenuOpen && (
            <div className="absolute right-0 top-11 glass-card rounded-xl shadow-xl p-2 z-30 animate-fade-in flex items-center gap-2">
              {WALLPAPER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => selectWallpaper(preset.id)}
                  title={preset.label}
                  className={`w-7 h-7 rounded-full ring-2 transition-all duration-200 ${
                    wallpaper === preset.id ? 'ring-neon-cyan' : 'ring-white/15 hover:ring-white/30'
                  }`}
                  style={{
                    background: preset.swatch,
                    backgroundColor: preset.id === 'none' ? 'transparent' : undefined,
                  }}
                >
                  {preset.id === 'none' && <X size={13} className="mx-auto text-white/50" />}
                </button>
              ))}
            </div>
          )}
        </div>
        {conversation?.isGroup && (
          <button
            onClick={() => setShowGroupInfo(true)}
            className="icon-btn p-2 rounded-full transition-all duration-300 shrink-0"
            title="Информация о группе"
          >
            <Settings size={17} />
          </button>
        )}
        {!conversation?.isGroup && !conversation?.isSelf && (
          <div className="relative shrink-0" data-user-menu>
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              className={`icon-btn p-2 rounded-full transition-all duration-300 ${userMenuOpen ? 'text-neon-cyan' : ''}`}
              title="Действия"
            >
              <MoreVertical size={17} />
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 top-11 glass-card rounded-xl shadow-xl py-1 min-w-52 z-30 animate-fade-in">
                <button
                  onClick={handleToggleBlock}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-white/80 hover:text-white hover:bg-white/5 transition-all duration-300"
                >
                  <Ban size={15} />
                  {conversation?.blockedByMe ? 'Разблокировать' : 'Заблокировать'}
                </button>
                <button
                  onClick={handleReport}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all duration-300"
                >
                  <Flag size={15} />
                  Пожаловаться
                </button>
              </div>
            )}
          </div>
        )}
          </>
        )}
      </div>
      {conversation?.pinnedMessage && (
        <button
          onClick={() => scrollToMessage(conversation.pinnedMessage.id)}
          className="glass-panel border-x-0 border-t-0 px-4 py-2 flex items-center gap-2.5 shrink-0 text-left animate-fade-in hover:bg-white/5 transition-colors duration-200"
        >
          <Pin size={15} className="text-cyan-300 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-cyan-300/90">Закреплённое сообщение</p>
            <p className="text-xs text-white/50 truncate">
              {conversation.pinnedMessage.text || (conversation.pinnedMessage.fileName ? 'Файл' : '')}
            </p>
          </div>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              togglePin(conversation.pinnedMessage);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                togglePin(conversation.pinnedMessage);
              }
            }}
            className="icon-btn p-1.5 rounded-full shrink-0"
            title="Открепить"
          >
            <X size={15} />
          </span>
        </button>
      )}
      {searchOpen && (
        <div className="glass-panel border-x-0 border-t-0 px-4 py-2.5 shrink-0 animate-fade-in relative">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по сообщениям в этом чате"
              className="glass-input w-full pl-9 pr-9 py-2 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="icon-btn absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full"
                title="Очистить"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {searchQuery.trim() && (
            <div className="mt-2 max-h-64 overflow-y-auto glass-card rounded-xl divide-y divide-white/5">
              {searching && <p className="text-white/30 text-xs p-3 text-center">Поиск...</p>}
              {!searching && searchResults.length === 0 && (
                <p className="text-white/30 text-xs p-3 text-center">Ничего не найдено</p>
              )}
              {!searching &&
                searchResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => jumpToMessage(r.id)}
                    className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors duration-200"
                  >
                    <p className="text-xs font-medium text-cyan-300/90 truncate">
                      {r.senderId === currentUserId ? 'Вы' : r.senderName || 'Пользователь'}
                      <span className="text-white/30 font-normal ml-2">{formatTime(r.createdAt)}</span>
                    </p>
                    <p className="text-xs text-white/60 truncate">{r.text}</p>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
      {viewingHistory && (
        <button
          onClick={jumpToLatest}
          className="mx-4 mt-2 flex items-center justify-center gap-2 px-3 py-1.5 rounded-full glass-input text-xs text-cyan-300 hover:text-cyan-200 transition-colors duration-200 shrink-0 self-center"
        >
          <ArrowDown size={13} />
          Вернуться к последним сообщениям
        </button>
      )}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto p-4 md:p-6 space-y-2.5 ${wallpaper !== 'none' ? `wallpaper-${wallpaper}` : ''}`}
      >
        {loadingMore && <p className="text-center text-white/30 text-xs pb-2">Загрузка...</p>}
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          const deleted = !!m.deletedAt;
          const showAvatar = !mine && (i === 0 || messages[i - 1].senderId !== m.senderId);
          const isImage = m.fileUrl && IMAGE_EXTENSIONS.test(m.fileUrl);
          // A captionless photo bleeds to the bubble's edges (Telegram/WhatsApp-style)
          // instead of sitting inside the same padding as text, which otherwise reads as a
          // thick colored frame around the photo. Only safe when nothing else (sender name,
          // forwarded label, reply preview) is rendered above it inside the bubble.
          const imageIsFirstContent = isImage && !m.text && !m.replyTo && !m.forwardedFromName && !(!mine && showAvatar);
          const editing = editingId === m.id;
          const read = mine && !deleted && isReadByOthers(m, conversation);
          const isFresh = !initialLoadIdsRef.current.has(m.id);
          const pending = m.status === 'sending' || m.status === 'failed';
          const pinned = conversation?.pinnedMessage?.id === m.id;
          const mentionsMe = !mine && conversation?.isGroup && m.mentions?.includes(currentUserId);
          const firstUrl = !deleted ? extractFirstUrl(m.text) : null;
          const showUnreadDivider =
            !mine &&
            unreadBoundaryRef.current &&
            new Date(m.createdAt) > new Date(unreadBoundaryRef.current) &&
            !(i > 0 && new Date(messages[i - 1].createdAt) > new Date(unreadBoundaryRef.current));
          return (
            <Fragment key={m.clientId || m.id}>
              {showUnreadDivider && (
                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 h-px bg-rose-400/30" />
                  <span className="text-[11px] text-rose-300/80 uppercase tracking-wide shrink-0">
                    Непрочитанные сообщения
                  </span>
                  <div className="flex-1 h-px bg-rose-400/30" />
                </div>
              )}
            <div
              className={`group relative flex items-end gap-2 ${isFresh ? 'animate-message-in' : ''} ${mine ? 'justify-end' : 'justify-start'}`}
            >
              {selectionMode && !pending && (
                <button
                  onClick={() => toggleSelected(m.id)}
                  className="absolute inset-0 z-10 cursor-pointer"
                  aria-label="Выбрать сообщение"
                />
              )}
              {selectionMode && !pending && (
                <button
                  onClick={() => toggleSelected(m.id)}
                  className={`flex items-center justify-center w-6 h-6 rounded-full border-2 mb-1 shrink-0 transition-colors duration-150 ${
                    selectedIds.has(m.id) ? 'bg-neon-violet border-neon-violet' : 'border-white/30'
                  }`}
                >
                  {selectedIds.has(m.id) && <Check size={14} className="text-white" />}
                </button>
              )}
              {!selectionMode && mine && !deleted && !editing && !pending && (
                <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 mb-1">
                  <button
                    onClick={() => setReplyingTo(buildReplyContext(m))}
                    className="icon-btn p-1.5 rounded-full"
                    title="Ответить"
                  >
                    <Reply size={13} />
                  </button>
                  <button
                    onClick={() => setForwardingMessage([m])}
                    className="icon-btn p-1.5 rounded-full"
                    title="Переслать"
                  >
                    <Forward size={13} />
                  </button>
                  <button
                    onClick={() => togglePin(m)}
                    className="icon-btn p-1.5 rounded-full"
                    title={pinned ? 'Открепить' : 'Закрепить'}
                  >
                    {pinned ? <PinOff size={13} /> : <Pin size={13} />}
                  </button>
                  <div className="relative" data-reaction-picker>
                    <button
                      onClick={() => setReactionPickerFor(reactionPickerFor === m.id ? null : m.id)}
                      className="icon-btn p-1.5 rounded-full"
                      title="Реакция"
                    >
                      <SmilePlus size={13} />
                    </button>
                    {reactionPickerFor === m.id && (
                      <div className="absolute bottom-full right-0 mb-1 glass-card rounded-full px-2 py-1.5 flex items-center gap-1 shadow-xl z-20 animate-fade-in">
                        {QUICK_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => toggleReaction(m, emoji)}
                            className="text-base hover:scale-125 transition-transform duration-150"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => startEdit(m)}
                    className="icon-btn p-1.5 rounded-full"
                    title="Редактировать"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(m)}
                    className="icon-btn p-1.5 rounded-full hover:text-rose-400"
                    title="Удалить"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
              {!mine && (
                <div className="w-8">
                  {showAvatar && <Avatar name={m.sender?.name} src={m.sender?.avatarUrl} size="sm" />}
                </div>
              )}
              <div
                id={`msg-${m.id}`}
                onTouchStart={() => handleBubbleTouchStart(m, deleted, pending, editing)}
                onTouchEnd={cancelBubbleLongPress}
                onTouchMove={cancelBubbleLongPress}
                onTouchCancel={cancelBubbleLongPress}
                onClickCapture={suppressPostLongPressClick}
                onContextMenu={(e) => openBubbleContextMenu(e, m, deleted, pending, editing)}
                className={`max-w-[75%] md:max-w-md px-4 py-2.5 shadow-sm transition-all duration-300 rounded-2xl no-native-selection ${
                  deleted
                    ? 'msg-bubble text-white/35 italic'
                    : mine
                    ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-[#fff] rounded-br-md'
                    : 'msg-bubble text-white/90 rounded-bl-md'
                } ${mentionsMe ? 'ring-2 ring-amber-400/60' : ''}`}
              >
                {!mine && !deleted && showAvatar && (
                  <p className="text-xs font-medium mb-1 text-cyan-300/90">{m.sender?.name}</p>
                )}
                {!deleted && m.forwardedFromName && (
                  <p className={`flex items-center gap-1 text-xs italic mb-1 ${mine ? 'text-[#fff]/70' : 'text-white/40'}`}>
                    <Forward size={11} />
                    Переслано от {m.forwardedFromName}
                  </p>
                )}
                {!deleted && m.replyTo && (
                  <button
                    onClick={() => scrollToMessage(m.replyTo.id)}
                    className={`block w-full text-left mb-1.5 pl-2 border-l-2 rounded-sm ${
                      mine ? 'border-[#fff]/40' : 'border-neon-cyan/50'
                    } opacity-80 hover:opacity-100 transition-opacity duration-200`}
                  >
                    <p className={`text-xs font-medium truncate ${mine ? 'text-[#fff]/80' : 'text-cyan-300/80'}`}>
                      {m.replyTo.senderId === currentUserId ? 'Вы' : m.replyTo.senderName || 'Пользователь'}
                    </p>
                    <p className={`text-xs truncate ${mine ? 'text-[#fff]/60' : 'text-white/50'}`}>
                      {m.replyTo.deleted
                        ? 'Сообщение удалено'
                        : m.replyTo.text || (m.replyTo.fileName ? 'Файл' : '')}
                    </p>
                  </button>
                )}
                {deleted && <p className="text-sm">Сообщение удалено</p>}
                {!deleted && editing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editText}
                      autoFocus
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(m);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      className="flex-1 bg-black/20 rounded-lg px-2 py-1 text-sm text-[#fff] outline-none ring-1 ring-[#fff]/20 focus:ring-[#fff]/40"
                    />
                    <button onClick={() => saveEdit(m)} className="icon-btn p-1 rounded-full shrink-0" title="Сохранить">
                      <Check size={15} />
                    </button>
                    <button onClick={cancelEdit} className="icon-btn p-1 rounded-full shrink-0" title="Отмена">
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <>
                    {!deleted && m.text && (
                      <p className="whitespace-pre-wrap break-words leading-relaxed">
                        {conversation?.isGroup
                          ? renderMessageText(
                              m.text,
                              m.mentions,
                              conversation.participants,
                              currentUserId,
                              currentUsername
                            )
                          : m.text}
                      </p>
                    )}
                    {firstUrl && <LinkPreview url={firstUrl} />}
                    {!deleted && m.fileUrl && isImage && (
                      <button
                        type="button"
                        onClick={() => setLightboxImage({ src: resolveFileUrl(m.fileUrl), alt: m.fileName })}
                        className={imageIsFirstContent ? '-mx-4 -mt-2.5 block w-[calc(100%+2rem)]' : 'block mt-1'}
                      >
                        <img
                          src={resolveFileUrl(m.fileUrl)}
                          alt={m.fileName || 'Фото'}
                          className={`max-w-full max-h-64 object-cover ${
                            imageIsFirstContent ? 'w-full rounded-t-2xl' : 'rounded-xl'
                          }`}
                        />
                      </button>
                    )}
                    {!deleted && m.fileUrl && !isImage && (
                      <a
                        href={resolveFileUrl(m.fileUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 mt-1 text-sm opacity-90 hover:opacity-100 underline"
                      >
                        <FileIcon size={15} className="shrink-0" />
                        <span className="truncate">{m.fileName || 'Файл'}</span>
                      </a>
                    )}
                  </>
                )}
                {!deleted && m.reactions?.length > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                    {groupReactions(m.reactions, currentUserId).map((g) => (
                      <button
                        key={g.emoji}
                        onClick={() => toggleReaction(m, g.emoji)}
                        className={`text-xs leading-none px-1.5 py-1 rounded-full flex items-center gap-1 transition-all duration-200 ${
                          g.mine ? 'bg-neon-violet/30 ring-1 ring-neon-violet/50' : 'bg-black/20 hover:bg-black/30'
                        }`}
                        title={g.mine ? 'Убрать реакцию' : 'Поставить реакцию'}
                      >
                        <span>{g.emoji}</span>
                        {g.count > 1 && <span className="text-[#fff]/70">{g.count}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {!deleted && m.status === 'failed' && (
                  <button
                    onClick={() => retrySend(m)}
                    className="flex items-center gap-1 mt-1 text-[11px] text-rose-300 hover:text-rose-200 transition-colors duration-200"
                    title="Не отправлено, нажмите чтобы повторить"
                  >
                    <AlertCircle size={13} />
                    Не отправлено · Повторить
                  </button>
                )}
                {!deleted && m.status !== 'failed' && (
                  <div
                    className={`flex items-center gap-1 mt-1 ${mine ? 'justify-end text-[#fff]/70' : 'text-white/35'}`}
                  >
                    {m.editedAt && <span className="text-[11px] italic">изменено</span>}
                    <span className="text-[11px]">{formatTime(m.createdAt)}</span>
                    {mine && m.status === 'sending' && <Clock size={13} className="text-[#fff]/50" />}
                    {mine && !m.status && conversation?.isGroup && (
                      <div className="relative" data-readby-picker>
                        <button
                          type="button"
                          onClick={() => setReadByFor(readByFor === m.id ? null : m.id)}
                          className="flex items-center"
                          title="Кто прочитал"
                        >
                          <CheckCheck size={14} className={read ? 'text-cyan-300' : 'text-[#fff]/50'} />
                        </button>
                        {readByFor === m.id &&
                          (() => {
                            const { read: readers, unread: notReaders } = readReceipts(m, conversation);
                            return (
                              <div className="absolute bottom-full right-0 mb-1 glass-card rounded-xl p-2.5 shadow-xl z-20 animate-fade-in min-w-48 max-h-56 overflow-y-auto text-left">
                                <p className="text-[10px] uppercase tracking-wide text-white/30 mb-1 px-1">
                                  Прочитали
                                </p>
                                {readers.length === 0 && (
                                  <p className="text-xs text-white/40 px-1 pb-1">Пока никто</p>
                                )}
                                {readers.map((p) => (
                                  <div key={p.id} className="flex items-center gap-2 py-1 px-1">
                                    <Avatar name={p.name} src={p.avatarUrl} size="sm" />
                                    <span className="text-xs text-white/80 truncate">{p.name}</span>
                                  </div>
                                ))}
                                {notReaders.length > 0 && (
                                  <>
                                    <p className="text-[10px] uppercase tracking-wide text-white/30 mt-2 mb-1 px-1">
                                      Ещё не видели
                                    </p>
                                    {notReaders.map((p) => (
                                      <div key={p.id} className="flex items-center gap-2 py-1 px-1 opacity-60">
                                        <Avatar name={p.name} src={p.avatarUrl} size="sm" />
                                        <span className="text-xs text-white/60 truncate">{p.name}</span>
                                      </div>
                                    ))}
                                  </>
                                )}
                              </div>
                            );
                          })()}
                      </div>
                    )}
                    {mine &&
                      !m.status &&
                      !conversation?.isGroup &&
                      (read ? (
                        <CheckCheck size={14} className="text-cyan-300" />
                      ) : (
                        <CheckCheck size={14} className="text-[#fff]/50" />
                      ))}
                  </div>
                )}
              </div>
              {!selectionMode && !mine && !deleted && !pending && (
                <div className="hidden md:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 mb-1 shrink-0">
                  <button
                    onClick={() => setReplyingTo(buildReplyContext(m))}
                    className="icon-btn p-1.5 rounded-full"
                    title="Ответить"
                  >
                    <Reply size={13} />
                  </button>
                  <button
                    onClick={() => setForwardingMessage([m])}
                    className="icon-btn p-1.5 rounded-full"
                    title="Переслать"
                  >
                    <Forward size={13} />
                  </button>
                  <button
                    onClick={() => togglePin(m)}
                    className="icon-btn p-1.5 rounded-full"
                    title={pinned ? 'Открепить' : 'Закрепить'}
                  >
                    {pinned ? <PinOff size={13} /> : <Pin size={13} />}
                  </button>
                  <div className="relative" data-reaction-picker>
                    <button
                      onClick={() => setReactionPickerFor(reactionPickerFor === m.id ? null : m.id)}
                      className="icon-btn p-1.5 rounded-full"
                      title="Реакция"
                    >
                      <SmilePlus size={13} />
                    </button>
                    {reactionPickerFor === m.id && (
                      <div className="absolute bottom-full left-0 mb-1 glass-card rounded-full px-2 py-1.5 flex items-center gap-1 shadow-xl z-20 animate-fade-in">
                        {QUICK_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => toggleReaction(m, emoji)}
                            className="text-base hover:scale-125 transition-transform duration-150"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            </Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="px-5 h-5">
        {typingUsers.size > 0 && (
          <p className="text-xs text-cyan-300/80 animate-fade-in">{typingLabel(typingUsers, conversation)}</p>
        )}
      </div>
      {mentionQuery !== null && mentionCandidates.length > 0 && (
        <div className="glass-panel border-x-0 border-b-0 px-2 py-1.5 shrink-0 animate-fade-in flex flex-col gap-0.5 max-h-40 overflow-y-auto">
          {mentionCandidates.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectMention(p)}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 text-left"
            >
              <Avatar name={p.name} src={p.avatarUrl} size="sm" />
              <span className="text-sm text-white/90 truncate">{p.name}</span>
              <span className="text-xs text-white/40 truncate">@{p.username}</span>
            </button>
          ))}
        </div>
      )}
      {replyingTo && (
        <div className="glass-panel border-x-0 border-b-0 px-4 py-2 flex items-center gap-2 shrink-0 animate-fade-in">
          <Reply size={15} className="text-cyan-300 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-cyan-300/90 truncate">
              {replyingTo.senderId === currentUserId ? 'Вы' : replyingTo.senderName || 'Пользователь'}
            </p>
            <p className="text-xs text-white/50 truncate">
              {replyingTo.deleted ? 'Сообщение удалено' : replyingTo.text || (replyingTo.fileName ? 'Файл' : '')}
            </p>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            className="icon-btn p-1.5 rounded-full shrink-0"
            title="Отменить ответ"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {pendingAttachment && (
        <div className="glass-panel border-x-0 border-b-0 px-4 py-2 flex items-center gap-2 shrink-0 animate-fade-in">
          {pendingAttachment.previewUrl ? (
            <img
              src={pendingAttachment.previewUrl}
              alt={pendingAttachment.name}
              className="w-10 h-10 rounded-lg object-cover shrink-0"
            />
          ) : (
            <span className="w-10 h-10 rounded-lg glass-input flex items-center justify-center shrink-0">
              <FileIcon size={16} className="text-white/60" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-white/80 truncate">{pendingAttachment.name}</p>
            <p className="text-xs text-white/40">{uploading ? 'Загрузка...' : 'Готово к отправке'}</p>
          </div>
          <button
            onClick={cancelAttachment}
            disabled={uploading}
            className="icon-btn p-1.5 rounded-full shrink-0 disabled:opacity-40"
            title="Убрать вложение"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {conversation?.blockedByMe || conversation?.blockedMe ? (
        <div className="glass-panel border-x-0 border-b-0 p-4 flex items-center justify-center gap-2 shrink-0 text-sm text-white/50">
          <Ban size={16} />
          {conversation.blockedByMe ? (
            <span>
              Вы заблокировали этого пользователя.{' '}
              <button onClick={handleToggleBlock} className="text-cyan-300 hover:text-cyan-200 underline">
                Разблокировать
              </button>
            </span>
          ) : (
            <span>Переписка недоступна.</span>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="glass-panel border-x-0 border-b-0 p-3 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="icon-btn p-2.5 rounded-full transition-all duration-300"
            title="Прикрепить файл"
          >
            <Paperclip size={19} />
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Сообщение..."
            rows={1}
            className="glass-input flex-1 px-4 py-2.5 rounded-3xl text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300 resize-none leading-relaxed max-h-[150px] overflow-y-auto"
          />
          <button
            type="submit"
            disabled={uploading || (!text.trim() && !pendingAttachment)}
            className="p-2.5 rounded-full bg-gradient-to-br from-violet-600 to-cyan-500 text-[#fff] shadow-glow-violet disabled:opacity-40 disabled:shadow-none hover:brightness-110 transition-all duration-300"
            title="Отправить"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </form>
      )}
      {showGroupInfo && conversation && (
        <GroupInfoModal
          conversation={conversation}
          currentUserId={currentUserId}
          onClose={() => setShowGroupInfo(false)}
          onUpdated={(updated) => setConversation(updated)}
          onLeft={() => {
            setShowGroupInfo(false);
            navigate('/', { replace: true });
          }}
        />
      )}
      {profileUserId && (
        <UserProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
      )}
      {forwardingMessage && (
        <ForwardModal messages={forwardingMessage} onClose={() => setForwardingMessage(null)} />
      )}
      {lightboxImage && (
        <Lightbox src={lightboxImage.src} alt={lightboxImage.alt} onClose={() => setLightboxImage(null)} />
      )}
      {mobileActionsFor && (
        <div
          onClick={() => setMobileActionsFor(null)}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end justify-center z-[60] animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-card w-full max-w-md rounded-t-3xl md:rounded-b-3xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:mb-6 animate-slide-up"
          >
            <div className="w-9 h-1 rounded-full bg-white/20 mx-auto mb-3" />
            <div className="flex items-center justify-center gap-2 pb-3 mb-2 border-b border-white/10">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    toggleReaction(mobileActionsFor, emoji);
                    setMobileActionsFor(null);
                  }}
                  className="text-2xl p-1.5 rounded-full active:scale-90 transition-transform duration-150"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setReplyingTo(buildReplyContext(mobileActionsFor));
                setMobileActionsFor(null);
              }}
              className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-white/85 active:bg-white/5"
            >
              <Reply size={18} />
              <span className="text-sm">Ответить</span>
            </button>
            {mobileActionsFor.text && (
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(mobileActionsFor.text);
                  setMobileActionsFor(null);
                }}
                className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-white/85 active:bg-white/5"
              >
                <Copy size={18} />
                <span className="text-sm">Копировать текст</span>
              </button>
            )}
            <button
              onClick={() => {
                setForwardingMessage([mobileActionsFor]);
                setMobileActionsFor(null);
              }}
              className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-white/85 active:bg-white/5"
            >
              <Forward size={18} />
              <span className="text-sm">Переслать</span>
            </button>
            <button
              onClick={() => {
                togglePin(mobileActionsFor);
                setMobileActionsFor(null);
              }}
              className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-white/85 active:bg-white/5"
            >
              {conversation?.pinnedMessage?.id === mobileActionsFor.id ? (
                <PinOff size={18} />
              ) : (
                <Pin size={18} />
              )}
              <span className="text-sm">
                {conversation?.pinnedMessage?.id === mobileActionsFor.id ? 'Открепить' : 'Закрепить'}
              </span>
            </button>
            <button
              onClick={() => enterSelectionMode(mobileActionsFor.id)}
              className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-white/85 active:bg-white/5"
            >
              <CheckSquare size={18} />
              <span className="text-sm">Выбрать</span>
            </button>
            {mobileActionsFor.senderId === currentUserId && (
              <>
                <button
                  onClick={() => {
                    startEdit(mobileActionsFor);
                    setMobileActionsFor(null);
                  }}
                  className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-white/85 active:bg-white/5"
                >
                  <Pencil size={18} />
                  <span className="text-sm">Редактировать</span>
                </button>
                <button
                  onClick={() => {
                    const target = mobileActionsFor;
                    setMobileActionsFor(null);
                    handleDelete(target);
                  }}
                  className="w-full flex items-center gap-3 px-2 py-3 rounded-xl text-rose-400 active:bg-rose-400/10"
                >
                  <Trash2 size={18} />
                  <span className="text-sm">Удалить</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
