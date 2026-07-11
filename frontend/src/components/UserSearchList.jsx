import { useEffect, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { api } from '../api/client';
import Avatar from './Avatar';

// Username-only search box + result list, shared by NewChatModal and GroupInfoModal.
// Never browses the full user directory: results only appear once the user has typed something.
export default function UserSearchList({ excludeIds = [], selectedIds = [], onToggle, placeholder }) {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    if (!search.trim()) {
      setUsers([]);
      return;
    }
    const timeout = setTimeout(() => {
      api.searchUsers(search).then((data) => setUsers(data.users));
    }, 250);
    return () => clearTimeout(timeout);
  }, [search]);

  const excluded = new Set(excludeIds);
  const results = users.filter((u) => !excluded.has(u.id));

  return (
    <div>
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
        <input
          type="text"
          placeholder={placeholder || 'Введите @никнейм'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="glass-input w-full pl-9 pr-3 py-2.5 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
        />
      </div>

      <div className="max-h-64 overflow-y-auto space-y-1">
        {results.map((u) => {
          const isSelected = selectedIds.includes(u.id);
          return (
            <button
              type="button"
              key={u.id}
              onClick={() => onToggle(u)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-300 ${
                isSelected ? 'bg-white/10 ring-1 ring-violet-400/40' : 'hover:bg-white/5'
              }`}
            >
              <Avatar name={u.name} src={u.avatarUrl} size="sm" />
              <span className="flex-1 text-left min-w-0">
                <span className="block text-white/90 truncate">{u.name}</span>
                <span className="block text-white/40 text-xs truncate">@{u.username}</span>
              </span>
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${
                  isSelected ? 'bg-gradient-to-br from-violet-500 to-cyan-400' : 'ring-1 ring-white/20'
                }`}
              >
                {isSelected && <Check size={13} className="text-white" />}
              </span>
            </button>
          );
        })}
        {search.trim() && results.length === 0 && (
          <p className="text-white/30 text-sm py-3 text-center">Никого не найдено</p>
        )}
        {!search.trim() && (
          <p className="text-white/30 text-sm py-3 text-center">Введите ник, чтобы найти человека</p>
        )}
      </div>
    </div>
  );
}
