"use client";
import { COLOR_PALETTES } from "@/lib/constants";

interface ColorPickerProps {
  value: string;
  onChange: (v: string) => void;
}

export default function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div>
      <label className="form-label">Color Palette</label>
      <div className="grid grid-cols-4 gap-2">
        {Object.entries(COLOR_PALETTES).map(([key, palette]) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            title={palette.label}
            className={`group flex flex-col items-center gap-1.5 rounded border p-2 text-center transition-all
              ${value === key
                ? "border-primary ring-1 ring-primary bg-primary/5"
                : "border-stroke dark:border-strokedark hover:border-primary/50"
              }`}
          >
            {palette.hex ? (
              <div
                className="h-6 w-full rounded"
                style={{ backgroundColor: palette.hex }}
              />
            ) : (
              <div className="h-6 w-full rounded bg-gradient-to-r from-blue-400 via-pink-400 to-yellow-400 opacity-60" />
            )}
            <span className="text-xs text-body leading-tight line-clamp-2">{palette.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
