"use client";
import { useState, useEffect } from "react";
import { Image as ImageIcon, Download, Trash2, Filter, Search, Grid3x3, LayoutList, X, Cloud } from "lucide-react";
import { TIKTOK_AD_THEMES } from "@/lib/constants";
import { dbSaveImages, dbLoadImages, dbDeleteImages, dbClearAll } from "@/lib/galleryDb";
import type { GalleryImageRecord } from "@/lib/galleryDb";

/**
 * toThumbnailUrl — transforms a Cloudinary URL to serve an optimized thumbnail.
 * For non-Cloudinary URLs (base64, etc.) returns the original.
 *
 * Examples:
 *   grid thumbnail : w=400, auto quality & format
 *   list thumbnail : w=80,  auto quality & format
 */
function toThumbnailUrl(url: string, width = 400): string {
  if (!url || !url.includes("res.cloudinary.com")) return url;
  // Insert transformation before /upload/ — e.g. /upload/w_400,c_limit,f_auto,q_auto/
  return url.replace("/upload/", `/upload/w_${width},c_limit,f_auto,q_auto/`);
}

/** Returns true if the URL is a Cloudinary CDN URL */
function isCloudinaryUrl(url: string): boolean {
  return !!url && url.includes("res.cloudinary.com");
}

// Re-export GalleryImage as alias for GalleryImageRecord (backward compat)
export type GalleryImage = GalleryImageRecord;

/**
 * saveImagesToGallery — called from tiktok-ads page after generation.
 * Saves to IndexedDB (no localStorage size limit).
 */
export async function saveImagesToGallery(images: GalleryImage[]): Promise<void> {
  try {
    await dbSaveImages(images);
  } catch (err) {
    console.error("[Gallery] Failed to save images to IndexedDB:", err);
  }
}

export default function GalleryPage() {
  const [images, setImages]       = useState<GalleryImage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [filterTheme, setFilterTheme] = useState("all");
  const [view, setView]           = useState<"grid" | "list">("grid");
  const [selected, setSelected]   = useState<string[]>([]);
  const [preview, setPreview]     = useState<GalleryImage | null>(null);

  // Load from IndexedDB on mount
  useEffect(() => {
    dbLoadImages()
      .then((imgs) => { setImages(imgs); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = images.filter((img) => {
    const matchSearch = img.themeName.toLowerCase().includes(search.toLowerCase()) || img.filename.includes(search);
    const matchTheme  = filterTheme === "all" || String(img.themeId) === filterTheme;
    return matchSearch && matchTheme;
  });

  const toggleSelect = (id: string) =>
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const deleteSelected = async () => {
    await dbDeleteImages(selected);
    setImages((p) => p.filter((img) => !selected.includes(img.id)));
    setSelected([]);
  };

  const deleteOne = async (id: string) => {
    await dbDeleteImages([id]);
    setImages((p) => p.filter((img) => img.id !== id));
    setSelected((p) => p.filter((x) => x !== id));
  };

  const downloadImage = async (img: GalleryImage) => {
    try {
      // For Cloudinary URLs: use server-side proxy to bypass browser CORS restriction.
      // Direct <a download> on cross-origin URLs is ignored by browsers.
      // For data: URIs (base64): also proxy so browser treats it as a download.
      const proxyUrl = `/api/download?url=${encodeURIComponent(img.url)}&filename=${encodeURIComponent(img.filename)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = img.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke object URL after short delay to allow download to start
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch (err) {
      console.error("[Gallery] Download failed:", err);
      // Fallback: open in new tab
      window.open(img.url, "_blank", "noopener,noreferrer");
    }
  };

  const downloadSelected = () => {
    const toDownload = images.filter((img) => selected.includes(img.id));
    // Stagger downloads — some browsers block simultaneous popup/download triggers
    toDownload.forEach((img, i) => {
      setTimeout(() => downloadImage(img), i * 400);
    });
  };

  const clearAll = async () => {
    await dbClearAll();
    setImages([]);
    setSelected([]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="loader" />
        <span className="ml-3 text-sm text-body">Loading gallery...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title-md font-bold text-black dark:text-white flex items-center gap-2">
            <ImageIcon size={22} className="text-primary" />
            Image Gallery
          </h1>
          <p className="text-sm text-body mt-1">
            {images.length === 0
              ? "No images yet"
              : `${images.length} images · ${selected.length > 0 ? `${selected.length} selected` : "click to select"}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.length > 0 && (
            <>
              <button onClick={downloadSelected} className="btn-secondary text-sm py-2 px-4 flex items-center gap-1.5">
                <Download size={14} />
                Download ({selected.length})
              </button>
              <button onClick={deleteSelected} className="btn-danger text-sm py-2 px-4 flex items-center gap-1.5">
                <Trash2 size={14} />
                Delete ({selected.length})
              </button>
            </>
          )}
          {images.length > 0 && selected.length === 0 && (
            <button
              onClick={() => setSelected(filtered.map((i) => i.id))}
              className="btn-secondary text-sm py-2 px-4"
            >
              Select All
            </button>
          )}
          {images.length > 0 && (
            <button onClick={clearAll} className="btn-secondary text-sm py-2 px-4 flex items-center gap-1.5 text-danger">
              <Trash2 size={14} />
              Clear All
            </button>
          )}
          <button
            onClick={() => setView(view === "grid" ? "list" : "grid")}
            className="btn-secondary py-2 px-3"
          >
            {view === "grid" ? <LayoutList size={16} /> : <Grid3x3 size={16} />}
          </button>
        </div>
      </div>

      {/* Filters */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded border border-stroke dark:border-strokedark bg-white dark:bg-boxdark px-3 py-2 flex-1 min-w-48">
            <Search size={14} className="text-body flex-shrink-0" />
            <input
              className="flex-1 bg-transparent text-sm text-black dark:text-white placeholder:text-body focus:outline-none"
              placeholder="Search by theme or filename..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-body" />
            <select
              className="rounded border border-stroke dark:border-strokedark bg-white dark:bg-boxdark px-3 py-2 text-sm text-black dark:text-white focus:outline-none"
              value={filterTheme}
              onChange={(e) => setFilterTheme(e.target.value)}
            >
              <option value="all">All Themes</option>
              {TIKTOK_AD_THEMES.map((t) => (
                <option key={t.id} value={String(t.id)}>{t.id}. {t.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Empty state */}
      {images.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-20 gap-3">
          <ImageIcon size={40} className="text-stroke" />
          <p className="text-sm text-body">No images generated yet</p>
          <p className="text-xs text-body">Generated images will appear here automatically</p>
          <a href="/tiktok-ads" className="btn-primary py-2 px-5 text-sm">Generate Images</a>
        </div>
      )}

      {/* No results after filter */}
      {images.length > 0 && filtered.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-16 gap-3">
          <Search size={32} className="text-stroke" />
          <p className="text-sm text-body">No images match your filter</p>
        </div>
      )}

      {/* Gallery Grid */}
      {filtered.length > 0 && (
        <div className={view === "grid"
          ? "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
          : "space-y-2"
        }>
          {filtered.map((img) => (
            view === "grid" ? (
              <div
                key={img.id}
                className={`group relative cursor-pointer overflow-hidden rounded-sm border transition-all
                  ${selected.includes(img.id) ? "border-primary ring-2 ring-primary" : "border-stroke dark:border-strokedark"}`}
                onClick={() => toggleSelect(img.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={toThumbnailUrl(img.url, 400)}
                  alt={img.themeName}
                  className="w-full object-cover"
                  style={{ aspectRatio: `${img.width ?? 768}/${img.height ?? 1344}` }}
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all" />

                {/* Cloudinary CDN badge */}
                {isCloudinaryUrl(img.url) && (
                  <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-all">
                    <span className="flex items-center gap-0.5 rounded bg-blue-600/80 px-1.5 py-0.5 text-[9px] font-medium text-white">
                      <Cloud size={8} /> CDN
                    </span>
                  </div>
                )}

                {/* Action buttons on hover */}
                <div className="absolute top-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreview(img); }}
                    className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
                    title="Preview"
                  >
                    <ImageIcon size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); downloadImage(img); }}
                    className="rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
                    title="Download"
                  >
                    <Download size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteOne(img.id); }}
                    className="rounded bg-black/60 p-1.5 text-white hover:bg-danger/80"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-all">
                  <p className="text-xs font-medium text-white truncate">{img.themeName}</p>
                  <p className="text-xs text-white/60">{img.width}×{img.height}</p>
                </div>

                {selected.includes(img.id) && (
                  <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                    <span className="text-white text-xs">✓</span>
                  </div>
                )}
              </div>
            ) : (
              <div
                key={img.id}
                className={`flex items-center gap-4 rounded border p-3 cursor-pointer transition-all
                  ${selected.includes(img.id) ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                onClick={() => toggleSelect(img.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={toThumbnailUrl(img.url, 80)} alt={img.themeName} className="h-16 w-10 rounded object-cover flex-shrink-0" loading="lazy" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-black dark:text-white flex items-center gap-1.5">
                    {img.themeName}
                    {isCloudinaryUrl(img.url) && (
                      <span className="flex items-center gap-0.5 rounded bg-blue-600/20 px-1 py-0.5 text-[9px] font-medium text-blue-600 dark:text-blue-400 flex-shrink-0">
                        <Cloud size={8} /> CDN
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-body">{img.filename}</p>
                  <p className="text-xs text-body">
                    {img.width}×{img.height}
                    {img.model && ` · ${img.model}`}
                    {img.generationTime && ` · ${img.generationTime.toFixed(1)}s`}
                    {` · ${new Date(img.createdAt).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreview(img); }}
                    className="rounded p-1.5 text-body hover:text-primary hover:bg-gray dark:hover:bg-meta-4"
                    title="Preview"
                  >
                    <ImageIcon size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); downloadImage(img); }}
                    className="rounded p-1.5 text-body hover:text-primary hover:bg-gray dark:hover:bg-meta-4"
                    title="Download"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteOne(img.id); }}
                    className="rounded p-1.5 text-body hover:text-danger hover:bg-gray dark:hover:bg-meta-4"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div
          className="fixed inset-0 z-999 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt={preview.themeName} className="w-full rounded-sm object-contain max-h-[80vh]" />
            <div className="absolute top-2 right-2 flex gap-2">
              <button
                onClick={() => downloadImage(preview)}
                className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
              >
                <Download size={16} />
              </button>
              <button
                onClick={() => setPreview(null)}
                className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
              >
                <X size={16} />
              </button>
            </div>
            <div className="absolute bottom-0 left-0 right-0 rounded-b-sm bg-gradient-to-t from-black/80 to-transparent px-4 py-3">
              <p className="text-sm font-semibold text-white">{preview.themeName}</p>
              <p className="text-xs text-white/70">{preview.filename} · {preview.width}×{preview.height}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
