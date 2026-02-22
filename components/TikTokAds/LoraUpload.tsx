"use client";
import { useRef, useState } from "react";
import { Upload, CheckCircle, AlertCircle, X, Loader2, FileCode2 } from "lucide-react";

interface LoraUploadProps {
  label: string;
  hint?: string;
  /** Called with the Cloudinary secure_url once upload completes, or null when cleared */
  onUrl: (url: string | null) => void;
}

const MAX_SIZE_MB  = 500;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const ACCEPTED_EXT = [".safetensors", ".bin", ".pt"];

type UploadState = "idle" | "signing" | "uploading" | "done" | "error";

export default function LoraUpload({ label, hint, onUrl }: LoraUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [state,    setState]    = useState<UploadState>("idle");
  const [progress, setProgress] = useState(0);
  const [error,    setError]    = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ name: string; sizeMB: string } | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const clear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (xhrRef.current) xhrRef.current.abort();
    setState("idle");
    setProgress(0);
    setError(null);
    setFileInfo(null);
    setUploadedUrl(null);
    if (inputRef.current) inputRef.current.value = "";
    onUrl(null);
  };

  const processFile = async (file: File) => {
    setError(null);

    // Validate extension
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXT.includes(ext)) {
      setError(`File tidak didukung: ${ext}. Gunakan .safetensors atau .bin`);
      return;
    }

    // Validate size
    if (file.size > MAX_SIZE_BYTES) {
      setError(`File terlalu besar: ${(file.size / 1024 / 1024).toFixed(0)} MB. Maks ${MAX_SIZE_MB} MB.`);
      return;
    }

    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    setFileInfo({ name: file.name, sizeMB });

    // ── Step 1: Get signature from our server ──────────────────────────
    setState("signing");
    setProgress(0);

    let sigData: {
      signature: string;
      timestamp: number;
      api_key: string;
      cloud_name: string;
      folder: string;
      public_id: string;
    };

    try {
      const publicId = `lora_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.[^.]+$/, "")}`;
      const sigRes = await fetch("/api/cloudinary/sign-lora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_id: publicId }),
      });
      if (!sigRes.ok) throw new Error(`Sign failed: ${sigRes.status}`);
      sigData = await sigRes.json();
    } catch (err) {
      setError(`Gagal mendapat signature: ${err instanceof Error ? err.message : String(err)}`);
      setState("error");
      return;
    }

    // ── Step 2: Upload file DIRECTLY to Cloudinary (bypasses Vercel limit) ──
    setState("uploading");
    setProgress(1);

    const formData = new FormData();
    formData.append("file",       file);
    formData.append("api_key",    sigData.api_key);
    formData.append("timestamp",  String(sigData.timestamp));
    formData.append("signature",  sigData.signature);
    formData.append("folder",     sigData.folder);
    formData.append("public_id",  sigData.public_id);
    formData.append("resource_type", "raw");   // raw = non-image binary files

    const uploadUrl = `https://api.cloudinary.com/v1_1/${sigData.cloud_name}/raw/upload`;

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setProgress(Math.round((ev.loaded / ev.total) * 95)); // cap at 95% until response
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const resp = JSON.parse(xhr.responseText) as { secure_url: string; error?: { message: string } };
            if (resp.error) { reject(new Error(resp.error.message)); return; }
            setProgress(100);
            setState("done");
            setUploadedUrl(resp.secure_url);
            onUrl(resp.secure_url);
            resolve();
          } catch {
            reject(new Error("Invalid JSON from Cloudinary"));
          }
        } else {
          try {
            const resp = JSON.parse(xhr.responseText) as { error?: { message: string } };
            reject(new Error(resp.error?.message ?? `HTTP ${xhr.status}`));
          } catch {
            reject(new Error(`HTTP ${xhr.status}`));
          }
        }
      };

      xhr.onerror   = () => reject(new Error("Network error"));
      xhr.onabort   = () => reject(new Error("Upload dibatalkan"));

      xhr.open("POST", uploadUrl);
      xhr.send(formData);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
      setState("error");
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  const isDragging = useRef(false);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      <label className="form-label">{label}</label>
      {hint && <p className="text-xs text-body mb-2">{hint}</p>}

      {/* ── Done state ── */}
      {state === "done" && uploadedUrl ? (
        <div className="rounded border border-stroke dark:border-strokedark overflow-hidden">
          <div className="flex items-center gap-3 bg-success/10 border-b border-success/20 px-3 py-3">
            <CheckCircle size={16} className="text-success flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-success truncate">{fileInfo?.name}</p>
              <p className="text-[10px] text-success/70">{fileInfo?.sizeMB} MB · Upload berhasil ☁️</p>
            </div>
            <button
              onClick={clear}
              className="text-xs text-body hover:text-danger transition-colors flex-shrink-0 ml-1"
            >
              Ganti
            </button>
          </div>
          <div className="px-3 py-2 bg-gray/50 dark:bg-meta-4/50">
            <p className="text-[10px] text-body font-mono truncate" title={uploadedUrl}>
              ☁️ {uploadedUrl.replace("https://res.cloudinary.com/", "…cloudinary.com/")}
            </p>
          </div>
        </div>
      ) : state === "uploading" || state === "signing" ? (
        /* ── Uploading state ── */
        <div className="rounded border border-stroke dark:border-strokedark p-4">
          <div className="flex items-center gap-3 mb-3">
            <Loader2 size={16} className="text-primary animate-spin flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-black dark:text-white truncate">
                {state === "signing" ? "Mendapat signature..." : `Mengupload ${fileInfo?.name ?? "file"}...`}
              </p>
              <p className="text-[10px] text-body">{fileInfo?.sizeMB} MB · direct ke Cloudinary</p>
            </div>
            <button
              onClick={clear}
              className="rounded-full bg-danger/10 p-1 text-danger hover:bg-danger/20 transition-colors"
              title="Batalkan upload"
            >
              <X size={12} />
            </button>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 rounded-full bg-stroke dark:bg-strokedark overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-body mt-1 text-right">{progress}%</p>
        </div>
      ) : (
        /* ── Drop zone / error state ── */
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); isDragging.current = true; }}
          onDragLeave={() => { isDragging.current = false; }}
          onClick={() => { setError(null); inputRef.current?.click(); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed transition-all p-6
            ${error
              ? "border-danger/50 bg-danger/5 hover:border-danger"
              : "border-stroke dark:border-strokedark hover:border-primary hover:bg-primary/3"
            }`}
        >
          <div className="rounded-full p-3 bg-gray dark:bg-meta-4">
            <FileCode2 size={20} className="text-body" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-black dark:text-white">
              Drop LoRA file atau <span className="text-primary">browse</span>
            </p>
            <p className="text-xs text-body mt-0.5">.safetensors / .bin — maks {MAX_SIZE_MB} MB</p>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-2 mt-2 rounded border border-danger/30 bg-danger/5 px-3 py-2">
          <AlertCircle size={14} className="text-danger flex-shrink-0 mt-0.5" />
          <p className="text-xs text-danger">{error}</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".safetensors,.bin,.pt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) processFile(f);
        }}
      />
    </div>
  );
}
