import { resolveFileUrl } from '../api/client';

// Fixed per-user avatar palette (literal hex, so the accent token remap in
// index.css doesn't collapse these into one colour). Telegram/VK-style hues.
const GRADIENTS = [
  'from-[#e17076] to-[#d5484f]', // red
  'from-[#f2934a] to-[#e2792f]', // orange
  'from-[#a67fe0] to-[#8b5cf0]', // purple
  'from-[#5fbf73] to-[#3ea857]', // green
  'from-[#5ec8d6] to-[#38b0c2]', // teal
  'from-[#5aa7f0] to-[#3d86e8]', // blue
  'from-[#ec7aae] to-[#e05593]', // pink
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const SIZES = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-lg',
};

export default function Avatar({ name, src, size = 'md', online = false, className = '', icon = null }) {
  const gradient = GRADIENTS[hashString(name || '?') % GRADIENTS.length];
  const sizeClasses = SIZES[size] || SIZES.md;

  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      {icon ? (
        <span
          className={`${sizeClasses} rounded-full flex items-center justify-center text-[#fff] bg-gradient-to-br from-cyan-500 to-blue-600 ring-1 ring-white/10`}
        >
          {icon}
        </span>
      ) : src ? (
        <img
          src={resolveFileUrl(src)}
          alt={name}
          className={`${sizeClasses} rounded-full object-cover ring-1 ring-white/10`}
        />
      ) : (
        <span
          className={`${sizeClasses} rounded-full flex items-center justify-center font-semibold text-[#fff] bg-gradient-to-br ${gradient} ring-1 ring-white/10`}
        >
          {initials(name)}
        </span>
      )}
      {online && (
        <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-surface-950 animate-pulse-glow" />
      )}
    </span>
  );
}
