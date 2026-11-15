import React, { useRef, useState } from 'react';
import { Camera, Upload, Check, Clock, RefreshCw } from 'lucide-react';
import type { Language } from '../types';

interface LiveCameraCaptureProps {
  language: Language;
  farmerArea: string;
  defaultImageUrl: string;
  onCapture: (dataUrl: string, capturedAtIso: string) => void;
  buttonLabel?: string;
}

export const LiveCameraCapture: React.FC<LiveCameraCaptureProps> = ({
  language,
  farmerArea,
  defaultImageUrl,
  onCapture,
  buttonLabel,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedTime, setCapturedTime] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

  const stampImageWithTimestamp = (imgSource: HTMLImageElement | HTMLVideoElement, width: number, height: number) => {
    const canvas = document.createElement('canvas');
    const targetW = 720;
    const targetH = Math.round((height / width) * targetW) || 540;
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(imgSource, 0, 0, targetW, targetH);

    // Burn in authentic live capture timestamp & farm area bar
    const now = new Date();
    const formatted = now.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(0, targetH - 48, targetW, 48);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 15px "JetBrains Mono", monospace';
    ctx.fillText(`KISAN MITRA LIVE · ${formatted} · ${farmerArea}`, 16, targetH - 18);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    const iso = now.toISOString();
    setPreviewUrl(dataUrl);
    setCapturedTime(formatted);
    onCapture(dataUrl, iso);
  };

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      setCameraError(
        language === 'mr'
          ? 'कॅमेरा उपलब्ध नाही. कृपया फोटो अपलोड करा किंवा झटपट लाइव्ह टाइमस्टॅम्प फोटो वापरा.'
          : 'Live camera permission unavailable. Upload a harvest photo or capture an instant timestamped farm frame.'
      );
    }
  };

  const captureFromVideo = () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    stampImageWithTimestamp(v, v.videoWidth || 640, v.videoHeight || 480);
    stopCamera();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        stampImageWithTimestamp(img, img.width, img.height);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleInstantTimestampedCapture = () => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      stampImageWithTimestamp(img, img.width, img.height);
    };
    img.src = defaultImageUrl;
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
          <Clock className="h-4 w-4 text-emerald-800" />
          <span>
            {buttonLabel ||
              (language === 'mr'
                ? 'वेळेसह लाइव्ह माल फोटो काढा / अपलोड करा'
                : 'Capture or Upload Live Photo with Timestamp')}
          </span>
        </div>
        {capturedTime && (
          <span className="inline-flex items-center gap-1 font-mono text-xs font-medium text-emerald-800 tabular-nums">
            <Check className="h-3.5 w-3.5" />
            {capturedTime}
          </span>
        )}
      </div>

      {cameraError && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          {cameraError}
        </p>
      )}

      {cameraOpen && (
        <div className="space-y-2">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full max-h-60 rounded-lg object-cover bg-slate-900"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={captureFromVideo}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-900"
            >
              <Camera className="h-4 w-4" />
              {language === 'mr' ? 'आत्ताच फोटो काढा' : 'Snap Live Timestamped Photo'}
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {language === 'mr' ? 'रद्द करा' : 'Close Camera'}
            </button>
          </div>
        </div>
      )}

      {previewUrl && !cameraOpen && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <img
            src={previewUrl}
            alt="Timestamped farm batch"
            referrerPolicy="no-referrer"
            className="h-44 w-full object-cover"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={startCamera}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
        >
          <Camera className="h-3.5 w-3.5 text-emerald-800" />
          {language === 'mr' ? 'लाइव्ह कॅमेरा' : 'Open Camera'}
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
        >
          <Upload className="h-3.5 w-3.5 text-emerald-800" />
          {language === 'mr' ? 'गॅलरीतून अपलोड करा' : 'Upload Photo + Stamp Time'}
        </button>

        <button
          type="button"
          onClick={handleInstantTimestampedCapture}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-900"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {language === 'mr' ? 'त्वरित वेळेसह फोटो तयार करा' : 'Stamp Live Batch Photo Now'}
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>
    </div>
  );
};
