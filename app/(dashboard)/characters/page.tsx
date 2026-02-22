"use client";
import { useState, useEffect } from "react";
import {
  User, Package, Trash2, Copy, CheckCircle,
  Clock, Zap, Search, Plus, RefreshCw,
  ChevronRight, Star, AlertCircle, Film,
} from "lucide-react";
import { dbLoadCharacters, dbDeleteCharacter, dbUpdateCharacterNotes } from "@/lib/charactersDb";
import type { CharacterRecord } from "@/lib/charactersDb";

// ── Helpers ───────────────────────────────────────────────────────────────────

function toThumbnailUrl(url: string, width = 300): string {
  if (!url) return url;
  // Cloudinary URL → add transformation params
  if (url.includes("res.cloudinary.com")) {
    return url.replace("/upload/", `/upload/w_${width},c_limit,f_auto,q_auto/`);
  }
  // base64 data URL → return as-is (cannot transform)
  return url;
}

function formatDuration(secs: number): string {
  if (secs < 60)   return `${Math.round(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
  return `${(secs / 3600).toFixed(1)}h`;
}

function timeAgo(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// ── Use-in-TikTok-Ads handoff ─────────────────────────────────────────────────
// Write LoRA URL + type to localStorage → TikTok Ads page reads on mount
function useInTikTokAds(character: CharacterRecord) {
  if (!character.loraUrl) return;
  localStorage.setItem("geovera_lora_handoff", JSON.stringify({
    type:     character.type,   // "actor" | "prop"
    loraUrl:  character.loraUrl,
    loraName: character.loraName,
    charName: character.name,
  }));
  window.location.href = "/tiktok-ads";
}

// ── CharacterCard ─────────────────────────────────────────────────────────────

function CharacterCard({
  character,
  onDelete,
  onCopyUrl,
}: {
  character: CharacterRecord;
  onDelete:  (id: string) => void;
  onCopyUrl: (url: string) => void;
}) {
  const [expanded,    setExpanded]    = useState(false);
  const [notes,       setNotes]       = useState(character.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [previewIdx,  setPreviewIdx]  = useState(0);

  const hasPreview = character.previewImages.length > 0;
  const isActor    = character.type === "actor";

  const saveNotes = async () => {
    setSavingNotes(true);
    await dbUpdateCharacterNotes(character.id, notes);
    setSavingNotes(false);
  };

  return (
    <div className="rounded-xl border border-stroke dark:border-strokedark bg-white dark:bg-boxdark overflow-hidden shadow-sm hover:shadow-md transition-shadow">

      {/* ── Preview image ── */}
      <div className="relative bg-gray-100 dark:bg-meta-4" style={{ aspectRatio: "1 / 1" }}>
        {hasPreview ? (
          <>
            <img
              src={toThumbnailUrl(character.previewImages[previewIdx] ?? character.previewImages[0])}
              alt={`${character.name} preview`}
              className="w-full h-full object-cover"
            />
            {/* Dot navigation */}
            {character.previewImages.length > 1 && (
              <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1 px-2">
                {character.previewImages.slice(0, 6).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setPreviewIdx(i)}
                    className={`h-1.5 rounded-full transition-all ${
                      i === previewIdx ? "w-5 bg-white" : "w-1.5 bg-white/50"
                    }`}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            {isActor
              ? <User    size={48} className="text-gray-300 dark:text-bodydark" />
              : <Package size={48} className="text-gray-300 dark:text-bodydark" />
            }
          </div>
        )}

        {/* Type badge */}
        <div className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide
          ${isActor ? "bg-primary text-white" : "bg-warning text-white"}`}>
          {isActor ? "Actor" : "Prop"}
        </div>

        {/* Age badge */}
        <div className="absolute top-2 right-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
          {timeAgo(character.createdAt)}
        </div>
      </div>

      {/* ── Info ── */}
      <div className="p-3 space-y-2.5">

        {/* Name + LoRA filename */}
        <div>
          <h3 className="text-sm font-bold text-black dark:text-white truncate leading-tight">{character.name}</h3>
          <p className="text-[10px] text-body truncate font-mono mt-0.5 leading-tight">{character.loraName}</p>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 text-[10px] text-body">
          <span className="flex items-center gap-0.5">
            <Zap size={10} className="text-primary" />
            {character.steps.toLocaleString()} steps
          </span>
          <span className="flex items-center gap-0.5">
            <Clock size={10} className="text-success" />
            {formatDuration(character.trainingTime)}
          </span>
          <span className="flex items-center gap-0.5 ml-auto">
            <Star size={10} className="text-warning" />
            {character.previewImages.length}
          </span>
        </div>

        {/* Primary CTA: Use in TikTok Ads */}
        {character.loraUrl ? (
          <button
            onClick={() => useInTikTokAds(character)}
            className="w-full flex items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-opacity-90 transition-colors"
          >
            <Film size={11} />
            Use in TikTok Ads
          </button>
        ) : (
          <div className="w-full flex items-center justify-center gap-1.5 rounded-md bg-stroke/50 px-2 py-1.5 text-[11px] text-body opacity-60">
            <AlertCircle size={11} />
            No LoRA URL saved
          </div>
        )}

        {/* Secondary actions row */}
        <div className="flex gap-1.5">
          {/* Copy URL */}
          {character.loraUrl && (
            <button
              onClick={() => onCopyUrl(character.loraUrl!)}
              className="flex-1 flex items-center justify-center gap-1 rounded-md border border-stroke dark:border-strokedark px-2 py-1.5 text-[10px] text-body hover:border-primary hover:text-primary transition-colors"
            >
              <Copy size={10} />
              Copy URL
            </button>
          )}

          {/* Delete */}
          <button
            onClick={() => {
              if (confirm(`Delete "${character.name}"? This cannot be undone.`)) {
                onDelete(character.id);
              }
            }}
            className="rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-[10px] text-danger hover:bg-danger/15 transition-colors"
          >
            <Trash2 size={11} />
          </button>
        </div>

        {/* Expand details */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between text-[10px] text-body hover:text-black dark:hover:text-white transition-colors pt-0.5"
        >
          <span>Details & Notes</span>
          <ChevronRight size={11} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>

        {/* Expanded */}
        {expanded && (
          <div className="pt-2 space-y-3 border-t border-stroke dark:border-strokedark">

            {/* Cloudinary URL */}
            {character.loraUrl && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold text-body uppercase tracking-wide">Cloudinary URL</p>
                <div className="flex items-center gap-2 rounded-md bg-black/5 dark:bg-meta-4/40 px-2 py-1.5">
                  <code className="flex-1 text-[9px] font-mono text-success truncate">
                    {character.loraUrl}
                  </code>
                  <button
                    onClick={() => onCopyUrl(character.loraUrl!)}
                    className="flex-shrink-0 text-body hover:text-primary transition-colors"
                  >
                    <Copy size={10} />
                  </button>
                </div>
              </div>
            )}

            {/* Created at */}
            <p className="text-[10px] text-body">
              Trained: {new Date(character.createdAt).toLocaleString()}
            </p>

            {/* Preview grid */}
            {character.previewImages.length > 1 && (
              <div className="grid grid-cols-3 gap-1">
                {character.previewImages.slice(0, 6).map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setPreviewIdx(i)}
                    className={`rounded overflow-hidden border-2 transition-colors ${
                      i === previewIdx ? "border-primary" : "border-transparent"
                    }`}
                  >
                    <img
                      src={toThumbnailUrl(img, 120)}
                      alt={`Preview ${i + 1}`}
                      className="w-full aspect-square object-cover"
                    />
                  </button>
                ))}
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-body uppercase tracking-wide">Notes</p>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this character..."
                rows={2}
                className="w-full rounded-md border border-stroke dark:border-strokedark bg-transparent px-2 py-1.5 text-[11px] text-black dark:text-white placeholder:text-body resize-none focus:outline-none focus:border-primary"
              />
              <button
                onClick={saveNotes}
                disabled={savingNotes}
                className="text-[10px] text-primary hover:underline disabled:opacity-50"
              >
                {savingNotes ? "Saving..." : "Save notes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CharactersPage() {
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [filter,     setFilter]     = useState<"all" | "actor" | "prop">("all");
  const [copied,     setCopied]     = useState(false);

  const loadCharacters = async () => {
    setLoading(true);
    try {
      const data = await dbLoadCharacters();
      setCharacters(data);
    } catch (err) {
      console.error("[Characters] Failed to load:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCharacters(); }, []);

  const handleDelete = async (id: string) => {
    await dbDeleteCharacter(id);
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filtered = characters.filter((c) => {
    const matchType   = filter === "all" || c.type === filter;
    const matchSearch = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.loraName.toLowerCase().includes(search.toLowerCase());
    return matchType && matchSearch;
  });

  const actorCount = characters.filter((c) => c.type === "actor").length;
  const propCount  = characters.filter((c) => c.type === "prop").length;

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-black dark:text-white">Trained Characters</h1>
          <p className="text-sm text-body mt-0.5">
            LoRA models trained on Modal A100-80GB · stored in Cloudinary
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={loadCharacters}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-stroke px-3 py-2 text-sm text-body hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <a
            href="/training"
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-opacity-90 transition-colors"
          >
            <Plus size={14} />
            Train New
          </a>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-stroke dark:border-strokedark bg-white dark:bg-boxdark p-4">
          <p className="text-xs text-body uppercase tracking-wide">Total LoRAs</p>
          <p className="text-2xl font-bold text-black dark:text-white mt-1">{characters.length}</p>
        </div>
        <div className="rounded-xl border border-stroke dark:border-strokedark bg-white dark:bg-boxdark p-4">
          <p className="text-xs text-primary uppercase tracking-wide">Actor LoRAs</p>
          <p className="text-2xl font-bold text-primary mt-1">{actorCount}</p>
        </div>
        <div className="rounded-xl border border-stroke dark:border-strokedark bg-white dark:bg-boxdark p-4">
          <p className="text-xs text-warning uppercase tracking-wide">Prop LoRAs</p>
          <p className="text-2xl font-bold text-warning mt-1">{propCount}</p>
        </div>
      </div>

      {/* ── Copy toast ── */}
      {copied && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg bg-success px-4 py-2.5 text-white shadow-lg text-sm font-medium">
          <CheckCircle size={14} />
          LoRA URL copied to clipboard!
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-body" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or LoRA file..."
            className="w-full rounded-md border border-stroke dark:border-strokedark bg-transparent pl-9 pr-3 py-2 text-sm text-black dark:text-white placeholder:text-body focus:outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-1 rounded-md border border-stroke dark:border-strokedark p-1">
          {(["all", "actor", "prop"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-xs font-medium capitalize transition-colors ${
                filter === f ? "bg-primary text-white" : "text-body hover:text-black dark:hover:text-white"
              }`}
            >
              {f === "all"   ? `All (${characters.length})`
               : f === "actor" ? `Actor (${actorCount})`
               : `Prop (${propCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-body">
          <RefreshCw size={24} className="animate-spin mr-3" />
          Loading characters...
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && characters.length === 0 && (
        <div className="rounded-xl border border-dashed border-stroke dark:border-strokedark bg-white dark:bg-boxdark p-12 text-center">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <User size={32} className="text-primary" />
          </div>
          <h3 className="text-base font-semibold text-black dark:text-white mb-2">No trained characters yet</h3>
          <p className="text-sm text-body mb-5">
            After training a LoRA, it will automatically appear here.
          </p>
          <div className="flex items-center justify-center gap-3">
            <a href="/training"
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-opacity-90 transition-colors">
              <Zap size={14} />
              Go to Training
            </a>
            <a href="/character-builder"
              className="flex items-center gap-1.5 rounded-md border border-stroke px-4 py-2 text-sm font-medium text-body hover:border-primary hover:text-primary transition-colors">
              <User size={14} />
              Character Builder
            </a>
          </div>
        </div>
      )}

      {/* ── No search results ── */}
      {!loading && characters.length > 0 && filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-stroke dark:border-strokedark bg-white dark:bg-boxdark p-8 text-center">
          <Search size={24} className="mx-auto mb-2 text-body" />
          <p className="text-sm text-body">No characters match your search.</p>
          <button onClick={() => { setSearch(""); setFilter("all"); }}
            className="mt-2 text-sm text-primary hover:underline">
            Clear filters
          </button>
        </div>
      )}

      {/* ── Character grid ── */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              onDelete={handleDelete}
              onCopyUrl={handleCopyUrl}
            />
          ))}
        </div>
      )}

      {/* ── How-to tip ── */}
      {!loading && characters.length > 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs text-body space-y-1.5">
          <p className="font-semibold text-primary text-[11px] uppercase tracking-wide">💡 Tips</p>
          <ul className="space-y-1">
            <li>• Klik <strong className="text-black dark:text-white">Use in TikTok Ads</strong> → LoRA otomatis terpilih di halaman generator</li>
            <li>• Klik <strong className="text-black dark:text-white">Copy URL</strong> → paste manual ke field LoRA URL di TikTok Ads</li>
            <li>• <strong className="text-black dark:text-white">Actor LoRA</strong>: wajah karakter konsisten di setiap gambar</li>
            <li>• <strong className="text-black dark:text-white">Prop LoRA</strong>: produk terlihat jelas dengan detail yang preserved</li>
          </ul>
        </div>
      )}
    </div>
  );
}
