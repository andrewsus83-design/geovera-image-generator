"use client";
import { useState } from "react";
import { TIKTOK_AD_THEMES, THEME_CATEGORIES } from "@/lib/constants";

interface ThemeSelectorProps {
  selected: number;
  onChange: (id: number) => void;
}

export default function ThemeSelector({ selected, onChange }: ThemeSelectorProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Filter themes by active category (or show all)
  const visibleThemes = activeCategory
    ? TIKTOK_AD_THEMES.filter((t) =>
        THEME_CATEGORIES.find((c) => c.label === activeCategory)?.ids.includes(t.id)
      )
    : TIKTOK_AD_THEMES;

  const selectedTheme = TIKTOK_AD_THEMES.find((t) => t.id === selected);

  return (
    <div className="space-y-3">
      {/* Selected theme preview */}
      {selectedTheme && (
        <div className="rounded border border-primary/30 bg-primary/5 px-3 py-2.5 flex items-start gap-2.5">
          <span className="text-primary text-xs font-bold mt-0.5 flex-shrink-0">#{selectedTheme.id}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary leading-tight truncate">{selectedTheme.name}</p>
            <p className="text-[11px] text-body mt-0.5 leading-tight">{selectedTheme.description}</p>
            <p className="text-[10px] text-body/70 mt-1 italic">{selectedTheme.mood} · {selectedTheme.lighting}</p>
          </div>
        </div>
      )}

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory(null)}
          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-all
            ${activeCategory === null
              ? "border-primary bg-primary text-white"
              : "border-stroke dark:border-strokedark text-body hover:border-primary/50 hover:text-primary"
            }`}
        >
          All ({TIKTOK_AD_THEMES.length})
        </button>
        {THEME_CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.label;
          const isSelectedInCat = cat.ids.includes(selected);
          return (
            <button
              key={cat.label}
              onClick={() => setActiveCategory(isActive ? null : cat.label)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-all flex items-center gap-1
                ${isActive
                  ? "border-primary bg-primary text-white"
                  : isSelectedInCat
                    ? "border-primary/40 bg-primary/8 text-primary"
                    : "border-stroke dark:border-strokedark text-body hover:border-primary/50 hover:text-primary"
                }`}
            >
              {cat.label}
              {isSelectedInCat && !isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
              )}
            </button>
          );
        })}
      </div>

      {/* Theme grid — single select radio-style */}
      <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
        {visibleThemes.map((theme) => {
          const isSelected = theme.id === selected;
          return (
            <button
              key={theme.id}
              onClick={() => onChange(theme.id)}
              title={`${theme.description}\n${theme.mood} · ${theme.lighting}`}
              className={`rounded border px-2.5 py-2 text-left transition-all
                ${isSelected
                  ? "border-primary bg-primary/10 shadow-sm"
                  : "border-stroke dark:border-strokedark hover:border-primary/40 hover:bg-gray dark:hover:bg-meta-4"
                }`}
            >
              <div className="flex items-center gap-1.5">
                {/* Radio dot */}
                <span className={`flex-shrink-0 w-3 h-3 rounded-full border-2 transition-all
                  ${isSelected
                    ? "border-primary bg-primary"
                    : "border-body/40"
                  }`}
                />
                <span className={`text-[10px] font-medium flex-shrink-0 tabular-nums
                  ${isSelected ? "text-primary" : "text-body/60"}`}>
                  #{theme.id}
                </span>
              </div>
              <p className={`text-xs font-semibold mt-1 leading-tight
                ${isSelected ? "text-primary" : "text-black dark:text-white"}`}>
                {theme.name}
              </p>
              <p className="text-[10px] text-body leading-tight mt-0.5 line-clamp-1">
                {theme.mood}
              </p>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-body text-center">
        {visibleThemes.length} themes{activeCategory ? ` in ${activeCategory}` : " total"} · klik untuk pilih
      </p>
    </div>
  );
}
