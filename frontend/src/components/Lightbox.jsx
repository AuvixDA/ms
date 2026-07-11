import { useEffect } from 'react';
import { Download, X } from 'lucide-react';

// Full-screen in-app image viewer, used instead of opening photos in a new browser tab.
export default function Lightbox({ src, alt, onClose }) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in p-4"
    >
      <img
        src={src}
        alt={alt || 'Фото'}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
      />
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <a
          href={src}
          download
          onClick={(e) => e.stopPropagation()}
          className="icon-btn glass-input p-2.5 rounded-full transition-all duration-300"
          title="Скачать"
        >
          <Download size={18} />
        </a>
        <button
          onClick={onClose}
          className="icon-btn glass-input p-2.5 rounded-full transition-all duration-300"
          title="Закрыть"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
