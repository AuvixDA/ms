import { useRef, useState } from 'react';
import { Camera, Crown, LogOut, Pencil, Shield, ShieldOff, UserPlus, Users, X } from 'lucide-react';
import { api } from '../api/client';
import Avatar from './Avatar';
import UserSearchList from './UserSearchList';
import CropModal from './CropModal';

export default function GroupInfoModal({ conversation, currentUserId, onClose, onUpdated, onLeft }) {
  const [name, setName] = useState(conversation.name || '');
  const [editingName, setEditingName] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState([]);
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const [error, setError] = useState('');
  const avatarInputRef = useRef(null);
  // Groups created before ownership existed have no ownerId — leave those unrestricted
  // rather than hiding moderation controls nobody can otherwise reach. Mirrors the
  // equivalent bypass in the backend's rename/remove-participant routes.
  const isOwner = conversation.ownerId === currentUserId;
  const canModerate = !conversation.ownerId || isOwner || conversation.selfRole === 'admin';

  function handleAvatarChange(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setCropSrc(URL.createObjectURL(file));
  }

  function handleCropCancel() {
    setCropSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  async function handleCropped(blob) {
    handleCropCancel();
    setAvatarBusy(true);
    try {
      const { fileUrl } = await api.uploadFile(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      const { conversation: updated } = await api.updateGroupAvatar(conversation.id, fileUrl);
      onUpdated(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function saveName() {
    if (!name.trim() || name.trim() === conversation.name) {
      setEditingName(false);
      return;
    }
    setBusy(true);
    try {
      const { conversation: updated } = await api.renameConversation(conversation.id, name.trim());
      onUpdated(updated);
      setEditingName(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (toAdd.length === 0) return;
    setBusy(true);
    try {
      const { conversation: updated } = await api.addParticipants(
        conversation.id,
        toAdd.map((u) => u.id)
      );
      onUpdated(updated);
      setToAdd([]);
      setAdding(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSetRole(userId, role) {
    setBusy(true);
    try {
      await api.setParticipantRole(conversation.id, userId, role);
      onUpdated({
        ...conversation,
        participants: conversation.participants.map((p) => (p.id === userId ? { ...p, role } : p)),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(userId) {
    setBusy(true);
    try {
      await api.removeParticipant(conversation.id, userId);
      if (userId === currentUserId) {
        onLeft();
      } else {
        onUpdated({
          ...conversation,
          participants: conversation.participants.filter((p) => p.id !== userId),
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="glass-card rounded-2xl p-6 w-full max-w-md shadow-2xl transition-all duration-300">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Users size={18} className="text-cyan-300" />
            Информация о группе
          </h2>
          <button onClick={onClose} className="icon-btn p-1.5 rounded-full transition-all duration-300">
            <X size={18} />
          </button>
        </div>

        {error && (
          <p className="text-rose-400 text-sm mb-4 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 mb-5">
          {canModerate ? (
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy}
              className="relative group shrink-0 rounded-full"
              title="Изменить аватар группы"
            >
              <Avatar name={conversation.name || 'Группа'} src={conversation.avatarUrl} size="lg" />
              <span className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <Camera size={18} className="text-[#fff]" />
              </span>
            </button>
          ) : (
            <Avatar name={conversation.name || 'Группа'} src={conversation.avatarUrl} size="lg" />
          )}
          <input
            type="file"
            accept="image/*"
            ref={avatarInputRef}
            onChange={handleAvatarChange}
            className="hidden"
          />
        </div>

        <div className="mb-5">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                className="glass-input flex-1 px-4 py-2 rounded-full text-sm text-white outline-none focus:ring-2 focus:ring-neon-violet/50 transition-all duration-300"
              />
              <button
                onClick={saveName}
                disabled={busy}
                className="px-4 py-2 rounded-full text-sm font-medium bg-gradient-to-br from-violet-600 to-cyan-500 text-[#fff] shrink-0"
              >
                OK
              </button>
            </div>
          ) : canModerate ? (
            <button
              onClick={() => setEditingName(true)}
              className="flex items-center gap-2 text-white/90 hover:text-white transition-colors duration-300"
            >
              <span className="font-medium">{conversation.name || 'Группа'}</span>
              <Pencil size={14} className="text-white/40" />
            </button>
          ) : (
            <span className="font-medium text-white/90">{conversation.name || 'Группа'}</span>
          )}
        </div>

        <p className="text-xs uppercase tracking-wide text-white/30 mb-2">
          Участники ({conversation.participants.length + 1})
        </p>
        <div className="space-y-1 mb-4 max-h-48 overflow-y-auto">
          <div className="w-full flex items-center gap-3 px-3 py-2 rounded-xl">
            <Avatar name="Вы" size="sm" />
            <span className="flex-1 text-left text-white/60 text-sm flex items-center gap-1.5">
              Вы
              {isOwner && <Crown size={13} className="text-amber-400" />}
              {!isOwner && conversation.selfRole === 'admin' && <Shield size={13} className="text-cyan-300" />}
            </span>
          </div>
          {conversation.participants.map((p) => (
            <div key={p.id} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5">
              <Avatar name={p.name} src={p.avatarUrl} size="sm" />
              <span className="flex-1 text-left min-w-0">
                <span className="flex items-center gap-1.5 text-white/90 truncate">
                  {p.name}
                  {conversation.ownerId === p.id && <Crown size={13} className="text-amber-400 shrink-0" />}
                  {conversation.ownerId !== p.id && p.role === 'admin' && (
                    <Shield size={13} className="text-cyan-300 shrink-0" />
                  )}
                </span>
                <span className="block text-white/40 text-xs truncate">@{p.username}</span>
              </span>
              {isOwner && conversation.ownerId !== p.id && (
                <button
                  onClick={() => handleSetRole(p.id, p.role === 'admin' ? 'member' : 'admin')}
                  disabled={busy}
                  className="icon-btn p-1.5 rounded-full transition-all duration-300 shrink-0"
                  title={p.role === 'admin' ? 'Снять админку' : 'Сделать админом'}
                >
                  {p.role === 'admin' ? <ShieldOff size={14} /> : <Shield size={14} />}
                </button>
              )}
              {canModerate && conversation.ownerId !== p.id && (
                <button
                  onClick={() => handleRemove(p.id)}
                  disabled={busy}
                  className="icon-btn p-1.5 rounded-full transition-all duration-300 shrink-0"
                  title="Удалить из группы"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {adding ? (
          <div className="mb-4">
            <UserSearchList
              excludeIds={[currentUserId, ...conversation.participants.map((p) => p.id)]}
              selectedIds={toAdd.map((u) => u.id)}
              onToggle={(u) =>
                setToAdd((prev) =>
                  prev.some((x) => x.id === u.id) ? prev.filter((x) => x.id !== u.id) : [...prev, u]
                )
              }
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => {
                  setAdding(false);
                  setToAdd([]);
                }}
                className="px-4 py-2 rounded-full text-sm text-white/70 hover:text-white hover:bg-white/5 transition-all duration-300"
              >
                Отмена
              </button>
              <button
                onClick={handleAdd}
                disabled={toAdd.length === 0 || busy}
                className="px-5 py-2 rounded-full text-sm font-medium bg-gradient-to-br from-violet-600 to-cyan-500 text-[#fff] disabled:opacity-40 transition-all duration-300"
              >
                Добавить
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm text-white/80 hover:text-white hover:bg-white/5 ring-1 ring-white/10 transition-all duration-300 mb-3"
          >
            <UserPlus size={16} />
            Добавить участника
          </button>
        )}

        <button
          onClick={() => handleRemove(currentUserId)}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all duration-300"
        >
          <LogOut size={16} />
          Покинуть группу
        </button>
      </div>
      {cropSrc && <CropModal imageSrc={cropSrc} onCancel={handleCropCancel} onCropped={handleCropped} />}
    </div>
  );
}
