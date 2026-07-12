import { useEffect, useState } from 'react';
import { AtSign, Info, X } from 'lucide-react';
import { api } from '../api/client';
import { connectSocket } from '../socket';
import { formatLastSeen } from '../format';
import Avatar from './Avatar';

// Read-only view of another user's profile — the same information you see about yourself
// (avatar, name, @username, status, "about"), plus their online / last-seen state. Opened
// from the 1-1 chat header. Presence is queried and kept live over the same socket the rest
// of the app uses.
export default function UserProfileModal({ userId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [presence, setPresence] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api
      .getUserProfile(userId)
      .then((data) => active && setProfile(data.user))
      .catch((err) => active && setError(err.message));
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    const socket = connectSocket();
    socket.emit('presence:query', { userIds: [userId] }, (result) => {
      if (result?.[userId]) setPresence(result[userId]);
    });
    function handlePresenceUpdate({ userId: id, online, lastSeenAt }) {
      if (id !== userId) return;
      setPresence({ online, lastSeenAt: lastSeenAt ?? null });
    }
    socket.on('presence:update', handlePresenceUpdate);
    return () => socket.off('presence:update', handlePresenceUpdate);
  }, [userId]);

  const online = !!presence?.online;
  const lastSeen = presence?.lastSeenAt ?? profile?.lastSeenAt;
  const presenceLabel = online ? 'в сети' : formatLastSeen(lastSeen);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card rounded-2xl p-6 w-full max-w-sm shadow-2xl transition-all duration-300"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Профиль</h2>
          <button onClick={onClose} className="icon-btn p-1.5 rounded-full transition-all duration-300">
            <X size={18} />
          </button>
        </div>

        {error ? (
          <p className="text-rose-400 text-sm bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        ) : !profile ? (
          <p className="text-white/40 text-sm py-6 text-center">Загрузка…</p>
        ) : (
          <>
            <div className="flex items-center gap-4 mb-5">
              <Avatar name={profile.name} src={profile.avatarUrl} size="lg" online={online} />
              <div className="min-w-0">
                <p className="text-white font-semibold text-lg truncate">{profile.name}</p>
                <p className={`text-xs truncate ${online ? 'text-emerald-400' : 'text-white/40'}`}>
                  {presenceLabel || `@${profile.username}`}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="glass-input rounded-xl px-3 py-2.5 flex items-center gap-2.5">
                <AtSign size={15} className="text-cyan-300 shrink-0" />
                <span className="text-sm text-white/80 truncate">{profile.username}</span>
              </div>

              {profile.status && (
                <div className="glass-input rounded-xl px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-white/35 mb-0.5">Статус</p>
                  <p className="text-sm text-white/85 break-words">{profile.status}</p>
                </div>
              )}

              {profile.bio && (
                <div className="glass-input rounded-xl px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-white/35 mb-0.5 flex items-center gap-1.5">
                    <Info size={12} /> О себе
                  </p>
                  <p className="text-sm text-white/85 whitespace-pre-wrap break-words">{profile.bio}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
