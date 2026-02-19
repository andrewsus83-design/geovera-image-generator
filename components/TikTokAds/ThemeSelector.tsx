"use client";
import { TIKTOK_AD_THEMES } from "@/lib/constants";
import { CheckSquare, Square } from "lucide-react";

interface ThemeSelectorProps {
  selected: number[] | "all";
  onChange: (ids: number[] | "all") => void;
}

export default function ThemeSelector({ selected, onChange }: ThemeSelectorProps) {
  const allIds = TIKTOK_AD_THEMES.map((t) => t.id);
  const isAll = selected === "all";
  const selectedIds = isAll ? allIds : selected;

  const toggle = (id: number) => {
    if (isAll) {
      onChange(allIds.filter((i) => i !== id));
    } else {
      const arr = selectedIds as number[];
      onChange(arr.includes(id) ? arr.filter((i) => i !== id) : [...arr, id]);
    }
  };

  const toggleAll = () => {
    if (isAll || (selectedIds as number[]).length === allIds.length) {
      onChange([]);
    } else {
      onChange("all");
    }
  };

  const count = isAll ? allIds.length : selectedIds.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <label className="form-label mb-0">
          Ad Themes <span className="text-body font-normal">({count}/{allIds.length} selected)</span>
        </label>
        <button onClick={toggleAll} className="text-xs text-primary hover:underline">
          {isAll || count === allIds.length ? "Deselect All" : "Select All"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
        {TIKTOK_AD_THEMES.map((theme) => {
          const active = isAll || (selectedIds as number[]).includes(theme.id);
          return (
            <button
              key={theme.id}
              onClick={() => toggle(theme.id)}
              className={`flex items-start gap-2 rounded border p-2.5 text-left transition-all text-xs
                ${active
                  ? "border-primary bg-primary/5 dark:bg-primary/10"
                  : "border-stroke dark:border-strokedark hover:border-primary/50"
                }`}
            >
              <div className="mt-0.5 flex-shrink-0">
                {active
                  ? <CheckSquare size={14} className="text-primary" />
                  : <Square size={14} className="text-body" />
                }
              </div>
              <div className="min-w-0">
                <p className={`font-medium leading-tight truncate ${active ? "text-primary" : "text-black dark:text-white"}`}>
                  {theme.id}. {theme.name}
                </p>
                <p className="text-body mt-0.5 leading-tight line-clamp-1">{theme.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
