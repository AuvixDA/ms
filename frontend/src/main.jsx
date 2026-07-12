import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Keep the installed PWA feeling like a native app on iOS: block pinch-to-zoom, which Safari
// drives through its own non-standard gesture events (the viewport meta alone isn't always
// honoured in standalone mode). The app has no pinch interactions of its own, so swallowing
// these is safe. Double-tap zoom is handled by `touch-action: manipulation` in index.css.
const preventGesture = (e) => e.preventDefault();
document.addEventListener('gesturestart', preventGesture, { passive: false });
document.addEventListener('gesturechange', preventGesture, { passive: false });
document.addEventListener('gestureend', preventGesture, { passive: false });

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
