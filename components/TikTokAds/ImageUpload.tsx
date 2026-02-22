"use client";
import { useRef, useState, useEffect } from "react";
import { X, ImageIcon, CheckCircle, AlertCircle, Upload } from "lucide-react";

interface ImageUploadProps {
  label: string;
  hint?: string;
  value: File | null;
  onChange: (f: File | null) => void;
}

const MAX_SIZE_MB = 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

export default function ImageUpload({ label, hint, value, onChange }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileInfo, setFileInfo] = useState<{ name: string; sizeMB: string } | null>(null);

  // Sync with parent — if parent clears value, clear everything
  useEffect(() => {
    if (!value) {
      setPreview(null);
      setFileInfo(null);
      setError(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [value]);

  const processFile = (f: File) => {
    setError(null);

    // Validate type
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError(`File tidak didukung: ${f.type || "unknown"}. Gunakan PNG, JPG, atau WEBP.`);
      return;
    }

    // Validate size
    if (f.size > MAX_SIZE_BYTES) {
      setError(`File terlalu besar: ${(f.size / 1024 / 1024).toFixed(1)}MB. Maksimal ${MAX_SIZE_MB}MB.`);
      return;
    }

    // Generate preview
    const url = URL.createObjectURL(f);
    setPreview(url);
    setFileInfo({
      name: f.name,
      sizeMB: (f.size / 1024 / 1024).toFixed(2),
    });
    onChange(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setPreview(null);
    setFileInfo(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <label className="form-label">{label}</label>
      {hint && <p className="text-xs text-body mb-2">{hint}</p>}

      {/* ── Uploaded state ── */}
      {preview && value ? (
        <div className="rounded border border-stroke dark:border-strokedark overflow-hidden">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="preview" className="w-full h-40 object-cover" />
            <button
              onClick={clear}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
              title="Hapus gambar"
            >
              <X size={13} />
            </button>
          </div>
          {/* Success bar */}
          <div className="flex items-center gap-2 bg-success/10 border-t border-success/20 px-3 py-2">
            <CheckCircle size={14} className="text-success flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-success truncate">{fileInfo?.name}</p>
              <p className="text-[10px] text-success/70">{fileInfo?.sizeMB} MB · Upload berhasil ✓</p>
            </div>
            <button
              onClick={clear}
              className="text-xs text-body hover:text-danger transition-colors flex-shrink-0"
            >
              Ganti
            </button>
          </div>
        </div>
      ) : (
        /* ── Drop zone ── */
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => { setError(null); inputRef.current?.click(); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed transition-all p-6
            ${isDragging
              ? "border-primary bg-primary/5 scale-[1.01]"
              : error
                ? "border-danger/50 bg-danger/5 hover:border-danger"
                : "border-stroke dark:border-strokedark hover:border-primary hover:bg-primary/3"
            }`}
        >
          <div className={`rounded-full p-3 ${isDragging ? "bg-primary/10" : "bg-gray dark:bg-meta-4"}`}>
            {isDragging
              ? <Upload size={20} className="text-primary" />
              : <ImageIcon size={20} className="text-body" />
            }
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-black dark:text-white">
              {isDragging ? "Lepaskan untuk upload" : <>Drop gambar atau <span className="text-primary">browse</span></>}
            </p>
            <p className="text-xs text-body mt-0.5">PNG, JPG, WEBP — maks {MAX_SIZE_MB}MB</p>
          </div>
        </div>
      )}

      {/* ── Error state ── */}
      {error && (
        <div className="flex items-start gap-2 mt-2 rounded border border-danger/30 bg-danger/5 px-3 py-2">
          <AlertCircle size={14} className="text-danger flex-shrink-0 mt-0.5" />
          <p className="text-xs text-danger">{error}</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) processFile(f);
        }}
      />
    </div>
  );
}
