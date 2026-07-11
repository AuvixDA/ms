import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, Bell, BellOff, MoreVertical, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { connectSocket } from '../socket';
import { playNotificationSound } from '../notificationSound';
import NewChatModal from './NewChatModal';
import Avatar from './Avatar';

function conversationTitle(conversation) {
  if (conversation.isGroup) return conversation.name || 'Группа';
  const other = conversation.participants[0];
  return other?.name || other?.email || 'Пользователь';
}

export default function ChatList({ currentUserId, open, onClose }) {
  const [conversations, setConversations] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [onlineIds, setOnlineIds] = useState(new Set());
  const [query, setQuery] = useState('');
  const [view, setView] = useState('active');
  const [menuFor, setMenuFor] = useState(null);
  const menuRef = useRef(null);
  const navigate = useNavigate();
  const { conversationId } = useParams();
  // Read inside the socket effect below without making it re-subscribe on every change —
  // that effect only depends on currentUserId, so it would otherwise close over stale
  // values of the conversation list and the currently open chat.
  const conversationsRef = useRef(conversations);
  const conversationIdRef = useRef(conversationId);

  function refresh() {
    api.listConversations().then((data) => {
      setConversations(data.conversations);

      // presence:update only reports *changes*, so without this, everyone who was already
      // online before this tab connected would incorrectly show as offline until their
      // next state change. Backfill the current state for every 1-1 chat once on load.
      const otherIds = data.conversations
        .filter((c) => !c.isGroup)
        .map((c) => c.participants[0]?.id)
        .filter(Boolean);
      if (otherIds.length === 0) return;
      connectSocket().emit('presence:query', { userIds: otherIds }, (result) => {
        if (!result) return;
        setOnlineIds((prev) => {
          const next = new Set(prev);
          Object.entries(result).forEach(([id, info]) => {
            if (info.online) next.add(id);
            else next.delete(id);
          });
          return next;
        });
      });
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuFor(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const socket = connectSocket();

    function handleListChanged() {
      refresh();
    }

    // Plays a chime for messages from someone else, unless that chat is muted or it's the
    // exact conversation the user is already looking at with the tab in the foreground.
    function handleNewMessage(message) {
      refresh();
      if (message.senderId === currentUserId) return;
      const conv = conversationsRef.current.find((c) => c.id === message.conversationId);
      if (conv?.muted) return;
      const activelyViewing =
        conversationIdRef.current === message.conversationId && document.visibilityState === 'visible';
      if (activelyViewing) return;
      playNotificationSound();
    }

    function handlePresence({ userId, online }) {
      setOnlineIds((prev) => {
        const next = new Set(prev);
        if (online) next.add(userId);
        else next.delete(userId);
        return next;
      });
    }

    function handleConversationRead({ conversationId: cid, userId, readAt }) {
      if (userId !== currentUserId) return;
      setConversations((prev) =>
        prev.map((c) => (c.id === cid ? { ...c, unreadCount: 0, lastReadAt: readAt } : c))
      );
    }

    socket.on('message:new', handleNewMessage);
    socket.on('message:updated', handleListChanged);
    socket.on('message:deleted', handleListChanged);
    socket.on('presence:update', handlePresence);
    socket.on('conversation:new', handleListChanged);
    socket.on('conversation:updated', handleListChanged);
    socket.on('conversation:removed', handleListChanged);
    socket.on('conversation:read', handleConversationRead);
    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('message:updated', handleListChanged);
      socket.off('message:deleted', handleListChanged);
      socket.off('presence:update', handlePresence);
      socket.off('conversation:new', handleListChanged);
      socket.off('conversation:updated', handleListChanged);
      socket.off('conversation:removed', handleListChanged);
      socket.off('conversation:read', handleConversationRead);
    };
  }, [currentUserId]);

  function handleCreated(conversation) {
    setShowModal(false);
    setConversations((prev) => {
      if (prev.some((c) => c.id === conversation.id)) return prev;
      return [{ ...conversation, participants: conversation.participants
        .map((p) => p.user || p)
        .filter((u) => u.id !== currentUserId), lastMessage: null, unreadCount: 0, archived: false, muted: false }, ...prev];
    });
    navigate(`/chat/${conversation.id}`);
    onClose?.();
  }

  async function toggleArchive(c) {
    setMenuFor(null);
    const archived = !c.archived;
    setConversations((prev) => prev.map((x) => (x.id === c.id ? { ...x, archived } : x)));
    try {
      await api.updateConversationSettings(c.id, { archived });
    } catch {
      refresh();
    }
  }

  async function toggleMute(c) {
    setMenuFor(null);
    const muted = !c.muted;
    setConversations((prev) => prev.map((x) => (x.id === c.id ? { ...x, muted } : x)));
    try {
      await api.updateConversationSettings(c.id, { muted });
    } catch {
      refresh();
    }
  }

  async function handleDeleteChat(c) {
    setMenuFor(null);
    if (!window.confirm('Удалить чат из списка? История останется у собеседника.')) return;
    setConversations((prev) => prev.filter((x) => x.id !== c.id));
    try {
      await api.deleteConversation(c.id);
      if (conversationId === c.id) navigate('/', { replace: true });
    } catch {
      refresh();
    }
  }

  const visible = conversations.filter((c) => (view === 'archived' ? c.archived : !c.archived));
  const filtered = visible.filter((c) =>
    conversationTitle(c).toLowerCase().includes(query.trim().toLowerCase())
  );
  const archivedCount = conversations.filter((c) => c.archived).length;

  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm z-20 md:hidden animate-fade-in"
        />
      )}
      <div
        className={`w-full sm:w-80 md:w-80 glass-panel border-y-0 border-l-0 flex flex-col h-full absolute md:static inset-y-0 left-0 z-30 transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
      >
      <div className="p-3 flex items-center gap-2 shrink-0">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
            className="glass-input w-full pl-9 pr-3 py-2 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
          />
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="icon-btn glass-input p-2.5 rounded-full transition-all duration-300"
          title="Новый чат"
        >
          <Plus size={18} />
        </button>
      </div>
      {(archivedCount > 0 || view === 'archived') && (
        <div className="px-3 pb-2 shrink-0">
          <button
            onClick={() => setView((v) => (v === 'archived' ? 'active' : 'archived'))}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all duration-300 ${
              view === 'archived' ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5'
            }`}
          >
            <Archive size={15} />
            {view === 'archived' ? 'К активным чатам' : `Архив (${archivedCount})`}
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {filtered.map((c) => {
          const isOnline = !c.isGroup && c.participants[0] && onlineIds.has(c.participants[0].id);
          const active = conversationId === c.id;
          const hasUnread = c.unreadCount > 0;
          return (
            <div key={c.id} className="relative group">
              <button
                onClick={() => {
                  navigate(`/chat/${c.id}`);
                  onClose?.();
                }}
                className={`w-full flex items-center gap-3 text-left px-3 py-2.5 rounded-xl transition-all duration-300 ${
                  active
                    ? 'bg-gradient-to-r from-violet-500/20 to-cyan-500/10 ring-1 ring-white/10 shadow-glow-violet'
                    : 'hover:bg-white/5'
                }`}
              >
                <Avatar
                  name={conversationTitle(c)}
                  src={!c.isGroup ? c.participants[0]?.avatarUrl : null}
                  online={isOnline}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className={`font-medium truncate ${hasUnread ? 'text-white' : 'text-white/90'}`}>
                      {conversationTitle(c)}
                    </p>
                    {c.muted && <BellOff size={12} className="text-white/30 shrink-0" />}
                  </div>
                  <p className={`text-sm truncate mt-0.5 ${hasUnread ? 'text-white/70' : 'text-white/40'}`}>
                    {c.lastMessage?.deletedAt
                      ? 'Сообщение удалено'
                      : c.lastMessage?.text || (c.lastMessage?.fileUrl ? 'Файл' : 'Нет сообщений')}
                  </p>
                </div>
                {hasUnread && (
                  <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 text-[#fff] text-[11px] font-semibold flex items-center justify-center">
                    {c.unreadCount > 99 ? '99+' : c.unreadCount}
                  </span>
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuFor(menuFor === c.id ? null : c.id);
                }}
                className="icon-btn absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-surface-950/60"
                title="Действия с чатом"
              >
                <MoreVertical size={15} />
              </button>
              {menuFor === c.id && (
                <div
                  ref={menuRef}
                  className="absolute right-1.5 top-10 glass-card rounded-xl shadow-xl py-1 min-w-44 z-30 animate-fade-in"
                >
                  <button
                    onClick={() => toggleArchive(c)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-white/80 hover:text-white hover:bg-white/5 transition-all duration-300"
                  >
                    {c.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                    {c.archived ? 'Из архива' : 'В архив'}
                  </button>
                  <button
                    onClick={() => toggleMute(c)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-white/80 hover:text-white hover:bg-white/5 transition-all duration-300"
                  >
                    {c.muted ? <Bell size={15} /> : <BellOff size={15} />}
                    {c.muted ? 'Включить уведомления' : 'Заглушить'}
                  </button>
                  <button
                    onClick={() => handleDeleteChat(c)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all duration-300"
                  >
                    <Trash2 size={15} />
                    Удалить чат
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-white/30 text-sm p-4 text-center">
            {view === 'archived'
              ? 'В архиве пусто'
              : conversations.length === 0
              ? 'Нет чатов. Начните новый разговор.'
              : 'Ничего не найдено'}
          </p>
        )}
      </div>
      {showModal && <NewChatModal onClose={() => setShowModal(false)} onCreated={handleCreated} />}
      </div>
    </>
  );
}
