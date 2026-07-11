import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  CheckCheck,
  FileIcon,
  Paperclip,
  Pencil,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { api, resolveFileUrl } from '../api/client';
import { connectSocket } from '../socket';
import Avatar from './Avatar';
import GroupInfoModal from './GroupInfoModal';

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif)$/i;

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

export default function ChatWindow({ conversationId, currentUserId }) {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState('');
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const shouldStickToBottomRef = useRef(true);
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
    shouldStickToBottomRef.current = true;

    api.getMessages(conversationId).then((data) => {
      setMessages(data.messages);
      setHasMore(data.hasMore);
      markRead();
    });
    loadConversation();

    const socket = connectSocket();
    socket.emit('conversation:join', { conversationId });

    function handleNewMessage(message) {
      if (message.conversationId !== conversationId) return;
      setMessages((prev) => [...prev, message]);
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

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  async function loadOlderMessages() {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    const container = scrollRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;
    try {
      const data = await api.getMessages(conversationId, messages[0].id);
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

  function handleTextChange(e) {
    setText(e.target.value);
    emitTyping(true);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => emitTyping(false), 1500);
  }

  function sendMessage(fileUrl, fileName) {
    const trimmed = text.trim();
    if (!trimmed && !fileUrl) return;
    shouldStickToBottomRef.current = true;
    connectSocket().emit('message:send', {
      conversationId,
      text: trimmed || null,
      fileUrl: fileUrl || null,
      fileName: fileName || null,
    });
    setText('');
    emitTyping(false);
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage();
  }

  async function handleFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    const { fileUrl, fileName } = await api.uploadFile(file);
    sendMessage(fileUrl, fileName);
    e.target.value = '';
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

  const other = !conversation?.isGroup ? conversation?.participants[0] : null;

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <div className="glass-panel border-x-0 border-t-0 px-4 py-3 flex items-center gap-3 shrink-0">
        {conversation?.isGroup ? (
          <Avatar name={conversationTitle(conversation)} size="sm" />
        ) : (
          <Avatar name={other?.name} src={other?.avatarUrl} size="sm" />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white/90 truncate">{conversationTitle(conversation)}</p>
          {!conversation?.isGroup && other?.username && (
            <p className="text-xs text-white/40 truncate">@{other.username}</p>
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
      </div>
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-2.5">
        {loadingMore && <p className="text-center text-white/30 text-xs pb-2">Загрузка...</p>}
        {messages.map((m, i) => {
          const mine = m.senderId === currentUserId;
          const deleted = !!m.deletedAt;
          const showAvatar = !mine && (i === 0 || messages[i - 1].senderId !== m.senderId);
          const isImage = m.fileUrl && IMAGE_EXTENSIONS.test(m.fileUrl);
          const editing = editingId === m.id;
          const read = mine && !deleted && isReadByOthers(m, conversation);
          return (
            <div
              key={m.id}
              className={`group flex items-end gap-2 animate-message-in ${mine ? 'justify-end' : 'justify-start'}`}
            >
              {mine && !deleted && !editing && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 mb-1">
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
                className={`max-w-[75%] md:max-w-md px-4 py-2.5 shadow-lg transition-all duration-300 ${
                  deleted
                    ? 'glass-card text-white/35 italic rounded-2xl'
                    : mine
                    ? 'bg-gradient-to-br from-violet-600/90 to-indigo-600/90 text-white rounded-2xl rounded-br-md shadow-glow-violet'
                    : 'glass-card text-white/90 rounded-2xl rounded-bl-md'
                }`}
              >
                {!mine && !deleted && showAvatar && (
                  <p className="text-xs font-medium mb-1 text-cyan-300/90">{m.sender?.name}</p>
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
                      className="flex-1 bg-black/20 rounded-lg px-2 py-1 text-sm text-white outline-none ring-1 ring-white/20 focus:ring-white/40"
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
                      <a href={resolveFileUrl(m.fileUrl)} target="_blank" rel="noreferrer" className="block mt-1">
                        <img
                          src={resolveFileUrl(m.fileUrl)}
                          alt={m.fileName || 'Фото'}
                          className="max-w-full max-h-64 rounded-xl object-cover"
                        />
                      </a>
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
                {!deleted && (
                  <div
                    className={`flex items-center gap-1 mt-1 ${mine ? 'justify-end text-white/70' : 'text-white/35'}`}
                  >
                    {m.editedAt && <span className="text-[11px] italic">изменено</span>}
                    <span className="text-[11px]">{formatTime(m.createdAt)}</span>
                    {mine &&
                      (read ? (
                        <CheckCheck size={14} className="text-cyan-300" />
                      ) : (
                        <CheckCheck size={14} className="text-white/50" />
                      ))}
                  </div>
                )}
              </div>
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
        <input
          type="text"
          value={text}
          onChange={handleTextChange}
          placeholder="Сообщение..."
          className="glass-input flex-1 px-4 py-2.5 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="p-2.5 rounded-full bg-gradient-to-br from-violet-600 to-cyan-500 text-white shadow-glow-violet disabled:opacity-40 disabled:shadow-none hover:brightness-110 transition-all duration-300"
          title="Отправить"
        >
          <Send size={18} />
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
    </div>
  );
}
