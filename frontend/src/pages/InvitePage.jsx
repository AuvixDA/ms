import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { api } from '../api/client';
import Avatar from '../components/Avatar';

export default function InvitePage() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api
      .lookupUsername(username)
      .then((data) => setUser(data.user))
      .catch(() => setError('Пользователь не найден'))
      .finally(() => setLoading(false));
  }, [username]);

  async function handleStartChat() {
    if (!user) return;
    setStarting(true);
    try {
      const { conversation } = await api.createConversation([user.id], false);
      navigate(`/chat/${conversation.id}`, { replace: true });
    } catch (err) {
      setError(err.message);
      setStarting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center neon-bg px-4">
      <div className="glass-card rounded-2xl p-8 w-full max-w-sm shadow-2xl animate-fade-in text-center">
        {loading && <p className="text-white/50 text-sm">Загрузка...</p>}
        {!loading && error && (
          <>
            <p className="text-rose-400 text-sm mb-4 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
            <button
              onClick={() => navigate('/')}
              className="px-5 py-2 rounded-full text-sm font-medium bg-white/10 text-white hover:bg-white/15 transition-all duration-300"
            >
              На главную
            </button>
          </>
        )}
        {!loading && user && (
          <>
            <Avatar name={user.name} src={user.avatarUrl} size="lg" className="mx-auto mb-4" />
            <p className="text-white font-semibold text-lg">{user.name}</p>
            <p className="text-white/40 text-sm mb-6">@{user.username}</p>
            <button
              onClick={handleStartChat}
              disabled={starting}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-br from-violet-600 to-cyan-500 text-white py-2.5 rounded-full font-medium shadow-glow-violet hover:brightness-110 disabled:opacity-50 transition-all duration-300"
            >
              <MessageCircle size={17} />
              {starting ? 'Открываем чат...' : 'Написать'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
