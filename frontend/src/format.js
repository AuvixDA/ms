// "Last seen" label shared by the 1-1 chat header and the profile modal, so both phrase
// presence identically. Returns null when there's no timestamp to show.
export function formatLastSeen(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMin = Math.floor((now - date) / 60000);
  if (diffMin < 1) return 'был(а) в сети только что';
  if (diffMin < 60) return `был(а) в сети ${diffMin} мин назад`;
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `был(а) в сети сегодня в ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `был(а) в сети вчера в ${time}`;
  return `был(а) в сети ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
}
