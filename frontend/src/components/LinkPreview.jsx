import { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { api } from '../api/client';

// Shared across every LinkPreview instance for the lifetime of the tab — the same URL
// commonly appears in several messages (a shared link, a forward), and re-fetching each
// bubble's preview independently would be wasteful and slower to render.
const previewCache = new Map();

export default function LinkPreview({ url }) {
  const [preview, setPreview] = useState(() => previewCache.get(url) || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url));
      return;
    }
    let cancelled = false;
    api
      .getLinkPreview(url)
      .then((data) => {
        previewCache.set(url, data);
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed || (preview && !preview.title && !preview.description && !preview.image)) {
    return null;
  }
  if (!preview) {
    return (
      <div className="mt-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs text-white/30 animate-pulse">
        Загрузка превью...
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-1.5 flex items-start gap-2.5 rounded-xl border border-white/10 hover:border-white/20 bg-black/15 overflow-hidden transition-colors duration-200"
    >
      {preview.image && (
        <img src={preview.image} alt="" className="w-20 h-20 object-cover shrink-0" />
      )}
      <div className="min-w-0 py-2 pr-3 flex-1">
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-white/35 truncate">
          <Link2 size={10} />
          {preview.siteName || new URL(url).hostname}
        </p>
        {preview.title && <p className="text-xs font-medium text-white/90 truncate mt-0.5">{preview.title}</p>}
        {preview.description && (
          <p className="text-xs text-white/50 line-clamp-2 mt-0.5">{preview.description}</p>
        )}
      </div>
    </a>
  );
}
