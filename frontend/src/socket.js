import { io } from 'socket.io-client';
import { getToken } from './api/client';

let socket = null;

// Reuses the existing instance whenever one exists (even mid-reconnect), so concurrent
// callers (multiple components mounting in the same tick) never spin up duplicate
// connections — socket.io already retries the underlying transport on its own.
export function connectSocket() {
  if (socket) return socket;
  // Empty string falls back to the current origin (relative), matching the Vite dev
  // proxy locally. Set VITE_API_URL when the backend is deployed on a different domain.
  socket = io(import.meta.env.VITE_API_URL || '/', {
    auth: { token: getToken() },
    autoConnect: true,
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
