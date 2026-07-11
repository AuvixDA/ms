import { useState } from 'react';
import { Users, X } from 'lucide-react';
import { api } from '../api/client';
import UserSearchList from './UserSearchList';

export default function NewChatModal({ onClose, onCreated }) {
  const [selected, setSelected] = useState([]);
  const [groupName, setGroupName] = useState('');

  function toggleUser(user) {
    setSelected((prev) =>
      prev.some((u) => u.id === user.id) ? prev.filter((u) => u.id !== user.id) : [...prev, user]
    );
  }

  async function handleCreate() {
    if (selected.length === 0) return;
    const isGroup = selected.length > 1;
    const { conversation } = await api.createConversation(
      selected.map((u) => u.id),
      isGroup,
      isGroup ? groupName || 'Группа' : undefined
    );
    onCreated(conversation);
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="glass-card rounded-2xl p-6 w-full max-w-md shadow-2xl transition-all duration-300">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Users size={18} className="text-cyan-300" />
            Новый чат
          </h2>
          <button onClick={onClose} className="icon-btn p-1.5 rounded-full transition-all duration-300">
            <X size={18} />
          </button>
        </div>

        {selected.length > 1 && (
          <input
            type="text"
            placeholder="Название группы"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="glass-input w-full mb-3 px-4 py-2.5 rounded-full text-sm text-white placeholder-white/35 outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
          />
        )}

        <div className="mb-4">
          <UserSearchList
            selectedIds={selected.map((u) => u.id)}
            onToggle={toggleUser}
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full text-sm text-white/70 hover:text-white hover:bg-white/5 transition-all duration-300"
          >
            Отмена
          </button>
          <button
            onClick={handleCreate}
            disabled={selected.length === 0}
            className="px-5 py-2 rounded-full text-sm font-medium bg-gradient-to-br from-violet-600 to-cyan-500 text-[#fff] shadow-glow-violet disabled:opacity-40 disabled:shadow-none hover:brightness-110 transition-all duration-300"
          >
            Создать
          </button>
        </div>
      </div>
    </div>
  );
}
