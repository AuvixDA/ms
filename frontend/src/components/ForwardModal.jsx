import { useEffect, useState } from 'react';
import { Bookmark, Forward, Search, X } from 'lucide-react';
import { api } from '../api/client';
import { connectSocket } from '../socket';
import Avatar from './Avatar';

function conversationTitle(c) {
  if (c.isSelf) return 'Избранное';
  if (c.isGroup) return c.name || 'Группа';
  const other = c.participants[0];
  return other?.name || 'Пользователь';
}

// Forwarding sends a brand-new message to the target conversation over the same socket
// used for normal sends — the server checks membership per conversationId in the payload,
// not per socket room, so this works even for a conversation that isn't currently open.
export default function ForwardModal({ message, onClose }) {
  const [conversations, setConversations] = useState([]);
  const [query, setQuery] = useState('');
  const [sentTo, setSentTo] = useState(new Set());
  const [sendingId, setSendingId] = useState(null);

  useEffect(() => {
    api.listConversations().then((data) => setConversations(data.conversations));
  }, []);

  const filtered = conversations.filter((c) =>
    conversationTitle(c).toLowerCase().includes(query.trim().toLowerCase())
  );

  function forwardTo(conversationId) {
    setSendingId(conversationId);
    connectSocket().emit(
      'message:send',
      {
        conversationId,
        text: message.text,
        fileUrl: message.fileUrl,
        fileName: message.fileName,
        forwardedFromName: message.sender?.name || 'Пользователь',
      },
      (response) => {
        setSendingId(null);
        if (!response?.error) {
          setSentTo((prev) => new Set(prev).add(conversationId));
        }
      }
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="glass-card rounded-2xl p-6 w-full max-w-md shadow-2xl transition-all duration-300">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Forward size={18} className="text-cyan-300" />
            Переслать
          </h2>
          <button onClick={onClose} className="icon-btn p-1.5 rounded-full transition-all duration-300">
            <X size={18} />
          </button>
        </div>

        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск чата"
            className="glass-input w-full pl-9 pr-3 py-2.5 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
          />
        </div>

        <div className="max-h-72 overflow-y-auto space-y-1">
          {filtered.map((c) => {
            const done = sentTo.has(c.id);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => forwardTo(c.id)}
                disabled={sendingId === c.id || done}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-300 ${
                  done ? 'opacity-50' : 'hover:bg-white/5'
                }`}
              >
                <Avatar
                  name={conversationTitle(c)}
                  src={c.isGroup ? c.avatarUrl : !c.isSelf ? c.participants[0]?.avatarUrl : null}
                  size="sm"
                  icon={c.isSelf ? <Bookmark size={14} /> : null}
                />
                <span className="flex-1 text-left min-w-0 text-white/90 truncate">{conversationTitle(c)}</span>
                {done && <span className="text-xs text-emerald-400 shrink-0">Отправлено</span>}
                {sendingId === c.id && <span className="text-xs text-white/40 shrink-0">...</span>}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-white/30 text-sm py-3 text-center">Ничего не найдено</p>
          )}
        </div>
      </div>
    </div>
  );
}
