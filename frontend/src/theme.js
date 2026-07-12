const THEME_KEY = 'theme';
const LIGHT_THEME_COLOR = '#f0f2f5';
const DARK_THEME_COLOR = '#0e1621';

function applyThemeColorMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? LIGHT_THEME_COLOR : DARK_THEME_COLOR);
}

export function getTheme() {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.classList.toggle('light', theme === 'light');
  applyThemeColorMeta(theme);
}

export function toggleTheme() {
  const next = getTheme() === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}
