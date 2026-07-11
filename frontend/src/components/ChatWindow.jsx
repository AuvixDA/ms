import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  FileIcon,
  Forward,
  Loader2,
  Paperclip,
  Pencil,
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

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif)$/i;
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

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

function formatLastSeen(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMin = Math.floor((now - date) / 60000);
  if (diffMin < 1) return 'был(а) в сети только что';
  if (diffMin < 60) return `был(а) в сети ${diffMin} мин назад`;
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `был(а) в сети сегодня в ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `был(а) в сети вчера в ${time}`;
  return `был(а) в сети ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function conversationTitle(conversation) {
  if (!conversation) return '';
  if (conversation.isGroup) return conversation.name || 'Группа';
  const other = conversation.participants[0];
  return other?.name || `@${other?.username}` || 'Пользователь';
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

export default function ChatWindow({ conversationId, currentUserId, onOpenSidebar }) {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
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
  const navigate = useNavigate();

  function loadConversation() {
    api.getConversation(conversationId).then((data) => setConversation(data.conversation));
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

    socket.on('message:new', handleNewMessage);
    socket.on('message:updated', handleMessageUpdated);
    socket.on('message:deleted', handleMessageDeleted);
    socket.on('typing', handleTyping);
    socket.on('conversation:updated', handleConversationUpdated);
    socket.on('conversation:removed', handleConversationRemoved);
    socket.on('conversation:read', handleConversationRead);
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

  function handleTextChange(e) {
    setText(e.target.value);
    emitTyping(true);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => emitTyping(false), 1500);
  }

  // Enter sends the message; Shift+Enter (or Ctrl/Cmd+Enter) inserts a newline like most
  // chat apps, so people can write multi-paragraph messages without them being cut off.
  function handleKeyDown(e) {
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
        <button
          onClick={onOpenSidebar}
          className="icon-btn p-2 -ml-2 rounded-full transition-all duration-300 md:hidden shrink-0"
          title="К списку чатов"
        >
          <ArrowLeft size={19} />
        </button>
        {conversation?.isGroup ? (
          <Avatar name={conversationTitle(conversation)} size="sm" />
        ) : (
          <Avatar name={other?.name} src={other?.avatarUrl} size="sm" online={!!presence?.online} />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white/90 truncate">{conversationTitle(conversation)}</p>
          {!conversation?.isGroup && (
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
        {conversation?.isGroup && (
          <button
            onClick={() => setShowGroupInfo(true)}
            className="icon-btn p-2 rounded-full transition-all duration-300 shrink-0"
            title="Информация о группе"
          >
            <Settings size={17} />
          </button>
        )}
      </div>
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
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2.5">
        {loadingMore && <p className="text-center text-white/30 text-xs pb-2">Загрузка...</p>}
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          const deleted = !!m.deletedAt;
          const showAvatar = !mine && (i === 0 || messages[i - 1].senderId !== m.senderId);
          const isImage = m.fileUrl && IMAGE_EXTENSIONS.test(m.fileUrl);
          const editing = editingId === m.id;
          const read = mine && !deleted && isReadByOthers(m, conversation);
          const isFresh = !initialLoadIdsRef.current.has(m.id);
          const pending = m.status === 'sending' || m.status === 'failed';
          return (
            <div
              key={m.clientId || m.id}
              className={`group flex items-end gap-2 ${isFresh ? 'animate-message-in' : ''} ${mine ? 'justify-end' : 'justify-start'}`}
            >
              {mine && !deleted && !editing && !pending && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 mb-1">
                  <button
                    onClick={() => setReplyingTo(buildReplyContext(m))}
                    className="icon-btn p-1.5 rounded-full"
                    title="Ответить"
                  >
                    <Reply size={13} />
                  </button>
                  <button
                    onClick={() => setForwardingMessage(m)}
                    className="icon-btn p-1.5 rounded-full"
                    title="Переслать"
                  >
                    <Forward size={13} />
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
                className={`max-w-[75%] md:max-w-md px-4 py-2.5 shadow-lg transition-all duration-300 rounded-2xl ${
                  deleted
                    ? 'msg-bubble text-white/35 italic'
                    : mine
                    ? 'bg-gradient-to-br from-violet-600/90 to-indigo-600/90 text-[#fff] rounded-br-md shadow-glow-violet'
                    : 'msg-bubble text-white/90 rounded-bl-md'
                }`}
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
                      <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>
                    )}
                    {!deleted && m.fileUrl && isImage && (
                      <button
                        type="button"
                        onClick={() => setLightboxImage({ src: resolveFileUrl(m.fileUrl), alt: m.fileName })}
                        className="block mt-1"
                      >
                        <img
                          src={resolveFileUrl(m.fileUrl)}
                          alt={m.fileName || 'Фото'}
                          className="max-w-full max-h-64 rounded-xl object-cover"
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
                    {mine &&
                      !m.status &&
                      (read ? (
                        <CheckCheck size={14} className="text-cyan-300" />
                      ) : (
                        <CheckCheck size={14} className="text-[#fff]/50" />
                      ))}
                  </div>
                )}
              </div>
              {!mine && !deleted && !pending && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 mb-1 shrink-0">
                  <button
                    onClick={() => setReplyingTo(buildReplyContext(m))}
                    className="icon-btn p-1.5 rounded-full"
                    title="Ответить"
                  >
                    <Reply size={13} />
                  </button>
                  <button
                    onClick={() => setForwardingMessage(m)}
                    className="icon-btn p-1.5 rounded-full"
                    title="Переслать"
                  >
                    <Forward size={13} />
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
          );
        })}
        <div ref={bottomRef} />
      </div>
      <div className="px-5 h-5">
        {typingUsers.size > 0 && (
          <p className="text-xs text-cyan-300/80 animate-fade-in">печатает...</p>
        )}
      </div>
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
      {forwardingMessage && (
        <ForwardModal message={forwardingMessage} onClose={() => setForwardingMessage(null)} />
      )}
      {lightboxImage && (
        <Lightbox src={lightboxImage.src} alt={lightboxImage.alt} onClose={() => setLightboxImage(null)} />
      )}
    </div>
  );
}
