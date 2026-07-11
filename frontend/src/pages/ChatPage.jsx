import { useParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Copy, LogOut, Menu, MessageSquareDashed, Settings, UserCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import ChatList from '../components/ChatList';
import ChatWindow from '../components/ChatWindow';
import Avatar from '../components/Avatar';

export default function ChatPage() {
  const { user, logout, updateUser } = useAuth();
  const { conversationId } = useParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const avatarInputRef = useRef(null);

  const inviteLink = `${window.location.origin}/u/${user.username}`;

  useEffect(() => {
    setSidebarOpen(!conversationId);
  }, [conversationId]);

  async function handleAvatarChange(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setAvatarError('');
    setAvatarBusy(true);
    try {
      const { fileUrl } = await api.uploadFile(file);
      const { user: updated } = await api.updateProfile({ avatarUrl: fileUrl });
      updateUser(updated);
    } catch (err) {
      setAvatarError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  function copyInviteLink() {
    navigator.clipboard.writeText(inviteLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="h-screen flex flex-col neon-bg text-white overflow-hidden">
      <header className="glass-panel flex justify-between items-center px-4 py-3 z-40 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="icon-btn p-2 rounded-full transition-all duration-300 md:hidden"
            title="Список чатов"
          >
            <Menu size={19} />
          </button>
          <Avatar name={user.name} src={user.avatarUrl} size="sm" />
          <span className="font-semibold tracking-wide">{user.name}</span>
        </div>
        <div className="relative flex items-center gap-1">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="icon-btn p-2 rounded-full transition-all duration-300"
            title="Настройки"
          >
            <Settings size={19} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 glass-card rounded-xl shadow-xl py-1 min-w-40 animate-fade-in">
              <button
                onClick={() => {
                  setProfileOpen(true);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-white/80 hover:text-white hover:bg-white/5 transition-all duration-300"
              >
                <UserCircle2 size={16} />
                Мой профиль
              </button>
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-white/80 hover:text-white hover:bg-white/5 transition-all duration-300"
              >
                <LogOut size={16} />
                Выйти
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden relative">
        <ChatList currentUserId={user.id} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        {conversationId ? (
          <ChatWindow
            key={conversationId}
            conversationId={conversationId}
            currentUserId={user.id}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/30">
            <MessageSquareDashed size={56} strokeWidth={1.25} />
            <p className="text-sm">Выберите чат или начните новый</p>
          </div>
        )}
      </div>
      {profileOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
          <div className="glass-card rounded-2xl p-6 w-full max-w-sm shadow-2xl transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <UserCircle2 size={18} className="text-cyan-300" />
                Мой профиль
              </h2>
              <button
                onClick={() => setProfileOpen(false)}
                className="icon-btn p-1.5 rounded-full transition-all duration-300"
              >
                ×
              </button>
            </div>
            <div className="flex items-center gap-3 mb-5">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                disabled={avatarBusy}
                className="relative group shrink-0 rounded-full"
                title="Изменить аватар"
              >
                <Avatar name={user.name} src={user.avatarUrl} size="lg" />
                <span className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  <Camera size={18} className="text-white" />
                </span>
              </button>
              <input
                type="file"
                accept="image/*"
                ref={avatarInputRef}
                onChange={handleAvatarChange}
                className="hidden"
              />
              <div className="min-w-0">
                <p className="text-white font-medium truncate">{user.name}</p>
                <p className="text-white/40 text-sm truncate">@{user.username}</p>
              </div>
            </div>
            {avatarError && (
              <p className="text-rose-400 text-xs mb-3 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {avatarError}
              </p>
            )}
            <p className="text-white/40 text-xs mb-2">
              Поделитесь ссылкой, чтобы с вами можно было начать чат
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={inviteLink}
                className="glass-input flex-1 px-3 py-2 rounded-full text-xs text-white/70 outline-none"
              />
              <button
                onClick={copyInviteLink}
                className="icon-btn p-2.5 rounded-full transition-all duration-300 shrink-0"
                title="Скопировать ссылку"
              >
                {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
