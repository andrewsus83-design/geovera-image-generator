"use client";
import { useState } from "react";
import { Image as ImageIcon, Download, Trash2, Filter, Search, Grid3x3, LayoutList } from "lucide-react";
import { TIKTOK_AD_THEMES } from "@/lib/constants";

const MOCK_IMAGES = Array.from({ length: 12 }, (_, i) => ({
  id: String(i + 1),
  themeId: (i % 30) + 1,
  themeName: TIKTOK_AD_THEMES[i % 30].name,
  filename: `${String(i + 1).padStart(2, "0")}_theme_${i + 1}.png`,
  url: `https://picsum.photos/seed/${i + 100}/400/700`,
  width: 768, height: 1344,
  createdAt: new Date(Date.now() - i * 3600000).toISOString(),
}));

export default function GalleryPage() {
  const [search, setSearch] = useState("");
  const [filterTheme, setFilterTheme] = useState("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<string[]>([]);

  const filtered = MOCK_IMAGES.filter((img) => {
    const matchSearch = img.themeName.toLowerCase().includes(search.toLowerCase()) || img.filename.includes(search);
    const matchTheme = filterTheme === "all" || String(img.themeId) === filterTheme;
    return matchSearch && matchTheme;
  });

  const toggleSelect = (id: string) =>
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-title-md font-bold text-black dark:text-white flex items-center gap-2">
            <ImageIcon size={22} className="text-primary" />
            Image Gallery
          </h1>
          <p className="text-sm text-body mt-1">{MOCK_IMAGES.length} images generated</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.length > 0 && (
            <>
              <button className="btn-secondary text-sm py-2 px-4">
                <Download size={14} />
                Download ({selected.length})
              </button>
              <button className="btn-danger text-sm py-2 px-4">
                <Trash2 size={14} />
                Delete
              </button>
            </>
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

      {/* Gallery Grid */}
      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-20 gap-3">
          <ImageIcon size={40} className="text-stroke" />
          <p className="text-sm text-body">No images found</p>
          <a href="/tiktok-ads" className="btn-primary py-2 px-5 text-sm">Generate Images</a>
        </div>
      ) : (
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
                  src={img.url}
                  alt={img.themeName}
                  className="w-full aspect-[9/16] object-cover"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all" />
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
                <img src={img.url} alt={img.themeName} className="h-16 w-10 rounded object-cover flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-black dark:text-white">{img.themeName}</p>
                  <p className="text-xs text-body">{img.filename}</p>
                  <p className="text-xs text-body">{img.width}×{img.height} · {new Date(img.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="rounded p-1.5 text-body hover:text-primary hover:bg-gray dark:hover:bg-meta-4">
                    <Download size={14} />
                  </button>
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}
