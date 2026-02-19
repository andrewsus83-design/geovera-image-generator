"use client";
import { useRef, useState } from "react";
import { Upload, X, Image as ImageIcon } from "lucide-react";

interface ImageUploadProps {
  label: string;
  hint?: string;
  value: File | null;
  onChange: (f: File | null) => void;
}

export default function ImageUpload({ label, hint, value, onChange }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = (f: File) => {
    onChange(f);
    const url = URL.createObjectURL(f);
    setPreview(url);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
  };

  const clear = () => {
    onChange(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <label className="form-label">{label}</label>
      {hint && <p className="text-xs text-body mb-2">{hint}</p>}

      {preview ? (
        <div className="relative rounded border border-stroke dark:border-strokedark overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="preview" className="w-full h-36 object-cover" />
          <button
            onClick={clear}
            className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
          >
            <X size={14} />
          </button>
          <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-3 py-1.5">
            <p className="text-xs text-white truncate">{value?.name}</p>
          </div>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-stroke dark:border-strokedark hover:border-primary transition-colors p-6"
        >
          <div className="rounded-full bg-gray dark:bg-meta-4 p-3">
            <ImageIcon size={20} className="text-body" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-black dark:text-white">
              Drop image here or <span className="text-primary">browse</span>
            </p>
            <p className="text-xs text-body mt-0.5">PNG, JPG, WEBP up to 10MB</p>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}
