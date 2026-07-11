// In local dev this stays empty and Vite's proxy forwards relative requests to the
// backend (see vite.config.js). In production, when the frontend is deployed separately
// from the backend (e.g. Vercel + Railway), set VITE_API_URL to the backend's full URL.
const API_BASE = import.meta.env.VITE_API_URL || '';

function getToken() {
  return localStorage.getItem('token');
}

// Uploaded files (avatars, message attachments) come back from the backend as paths like
// `/uploads/xyz.png`. Those only resolve correctly when the browser is on the same origin
// as the backend, so route them through API_BASE too when the two are on different domains.
export function resolveFileUrl(path) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

async function request(path, { method = 'GET', body, isFormData = false } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isFormData && body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return data;
}

export const api = {
  register: (email, password, name, username) =>
    request('/auth/register', { method: 'POST', body: { email, password, name, username } }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  searchUsers: (search) => request(`/users?search=${encodeURIComponent(search || '')}`),
  lookupUsername: (username) => request(`/users/by-username/${encodeURIComponent(username)}`),
  listConversations: () => request('/conversations'),
  createConversation: (participantIds, isGroup, name) =>
    request('/conversations', { method: 'POST', body: { participantIds, isGroup, name } }),
  getConversation: (conversationId) => request(`/conversations/${conversationId}`),
  renameConversation: (conversationId, name) =>
    request(`/conversations/${conversationId}`, { method: 'PATCH', body: { name } }),
  updateConversationSettings: (conversationId, settings) =>
    request(`/conversations/${conversationId}/settings`, { method: 'PATCH', body: settings }),
  markConversationRead: (conversationId) =>
    request(`/conversations/${conversationId}/read`, { method: 'POST' }),
  deleteConversation: (conversationId) =>
    request(`/conversations/${conversationId}`, { method: 'DELETE' }),
  addParticipants: (conversationId, userIds) =>
    request(`/conversations/${conversationId}/participants`, { method: 'POST', body: { userIds } }),
  removeParticipant: (conversationId, userId) =>
    request(`/conversations/${conversationId}/participants/${userId}`, { method: 'DELETE' }),
  getMessages: (conversationId, before) =>
    request(`/conversations/${conversationId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  editMessage: (conversationId, messageId, text) =>
    request(`/conversations/${conversationId}/messages/${messageId}`, { method: 'PATCH', body: { text } }),
  deleteMessage: (conversationId, messageId) =>
    request(`/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' }),
  uploadFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return request('/upload', { method: 'POST', body: formData, isFormData: true });
  },
  updateProfile: (data) => request('/users/me', { method: 'PATCH', body: data }),
  getVapidPublicKey: () => request('/push/vapid-public-key'),
  subscribePush: (subscription) => request('/push/subscribe', { method: 'POST', body: subscription }),
};

export { getToken };
