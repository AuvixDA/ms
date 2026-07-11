import { resolveFileUrl } from '../api/client';

const GRADIENTS = [
  'from-violet-500 to-indigo-500',
  'from-cyan-500 to-blue-500',
  'from-pink-500 to-rose-500',
  'from-emerald-500 to-teal-500',
  'from-amber-500 to-orange-500',
  'from-fuchsia-500 to-purple-500',
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
