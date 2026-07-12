import { useCallback, useState } from 'react';
import Cropper from 'react-easy-crop';
import { Check, Loader2, X } from 'lucide-react';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', reject);
    img.src = src;
  });
}

async function getCroppedBlob(imageSrc, area) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = area.width;
  canvas.height = area.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

// A round, fixed-aspect crop step between picking a file and uploading it — avatars look
// far worse stretched/off-center than a couple of pinch-to-zoom seconds costs.
export default function CropModal({ imageSrc, onCancel, onCropped }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleCropComplete = useCallback((_, areaPixels) => {
    setCroppedAreaPixels(areaPixels);
  }, []);

  async function handleConfirm() {
    if (!croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels);
      onCropped(blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[70] animate-fade-in">
      <div className="glass-card rounded-2xl p-5 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Обрежьте фото</h2>
          <button onClick={onCancel} className="icon-btn p-1.5 rounded-full transition-all duration-300">
            <X size={18} />
          </button>
        </div>
        <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-black/40">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={handleCropComplete}
          />
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-full mt-4 accent-neon-violet"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-full text-sm text-white/70 hover:text-white hover:bg-white/5 transition-all duration-300"
          >
            Отмена
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy || !croppedAreaPixels}
            className="px-5 py-2 rounded-full text-sm font-medium bg-gradient-to-br from-violet-600 to-cyan-500 text-[#fff] disabled:opacity-40 transition-all duration-300 flex items-center gap-2"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
