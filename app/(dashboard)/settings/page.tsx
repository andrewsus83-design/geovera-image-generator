"use client";
import { useState } from "react";
import { Settings, Save, Eye, EyeOff, CheckCircle } from "lucide-react";

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [form, setForm] = useState({
    geminiKey: "",
    supabaseUrl: "",
    supabaseKey: "",
    vastEndpoint: "",
    vastKey: "",
    outputDir: "data/output/tiktok",
    defaultGpu: "any",
    defaultModel: "flux_dev",
  });

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = () => {
    Object.entries(form).forEach(([k, v]) => {
      if (v) localStorage.setItem(`geovera_${k}`, v);
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const InputField = ({ label, field, type = "text", placeholder }: {
    label: string; field: keyof typeof form; type?: string; placeholder?: string;
  }) => (
    <div>
      <label className="form-label">{label}</label>
      <div className="relative">
        <input
          type={type === "password" && showKeys ? "text" : type}
          className="form-input"
          placeholder={placeholder}
          value={form[field]}
          onChange={update(field)}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-title-md font-bold text-black dark:text-white flex items-center gap-2">
          <Settings size={22} className="text-primary" />
          Settings
        </h1>
        <p className="text-sm text-body mt-1">Configure API keys and default generation preferences</p>
      </div>

      {/* API Keys */}
      <div className="card">
        <div className="border-b border-stroke dark:border-strokedark px-6 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-black dark:text-white">API Keys</h2>
          <button
            onClick={() => setShowKeys(!showKeys)}
            className="flex items-center gap-1.5 text-xs text-body hover:text-black dark:hover:text-white"
          >
            {showKeys ? <EyeOff size={13} /> : <Eye size={13} />}
            {showKeys ? "Hide" : "Show"} keys
          </button>
        </div>
        <div className="p-6 space-y-4">
          <InputField label="Gemini API Key" field="geminiKey" type="password" placeholder="AIza..." />
          <InputField label="Supabase URL" field="supabaseUrl" placeholder="https://xxxx.supabase.co" />
          <InputField label="Supabase Anon Key" field="supabaseKey" type="password" placeholder="eyJ..." />
          <InputField label="vast.ai Endpoint URL" field="vastEndpoint" placeholder="https://xxxx.vast.ai:PORT" />
          <InputField label="vast.ai API Key" field="vastKey" type="password" placeholder="••••••••" />
        </div>
      </div>

      {/* Defaults */}
      <div className="card">
        <div className="border-b border-stroke dark:border-strokedark px-6 py-4">
          <h2 className="font-semibold text-black dark:text-white">Default Preferences</h2>
        </div>
        <div className="p-6 space-y-4">
          <InputField label="Default Output Directory" field="outputDir" placeholder="data/output/tiktok" />
          <div>
            <label className="form-label">Default GPU</label>
            <select className="form-select" value={form.defaultGpu} onChange={update("defaultGpu")}>
              <option value="any">Any (cheapest available)</option>
              <option value="rtx3090">RTX 3090 ($0.13/hr)</option>
              <option value="rtx3090ti">RTX 3090 Ti ($0.18/hr)</option>
              <option value="rtx4080">RTX 4080 ($0.20/hr)</option>
              <option value="rtx4090">RTX 4090 ($0.29/hr)</option>
              <option value="rtx5090">RTX 5090 ($0.37/hr)</option>
              <option value="a100">A100 80GB ($1.65/hr)</option>
              <option value="h100">H100 SXM ($1.65/hr)</option>
            </select>
          </div>
          <div>
            <label className="form-label">Default Model</label>
            <select className="form-select" value={form.defaultModel} onChange={update("defaultModel")}>
              <option value="flux_dev">Flux.1-dev (best quality)</option>
              <option value="flux_schnell">Flux.1-schnell (faster)</option>
              <option value="sdxl">SDXL (local GPU)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button onClick={handleSave} className="btn-primary py-2.5 px-8">
          {saved ? <><CheckCircle size={16} />Saved!</> : <><Save size={16} />Save Settings</>}
        </button>
        <p className="text-xs text-body">Settings are stored in your browser&apos;s localStorage</p>
      </div>

      {/* .env note */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-black dark:text-white mb-2">Production: Use .env file</h3>
        <p className="text-xs text-body mb-3">
          For deployment, set these in your <code className="bg-gray dark:bg-meta-4 px-1 rounded">.env.local</code> or Vercel environment variables:
        </p>
        <pre className="bg-gray dark:bg-meta-4 rounded p-3 text-xs text-body overflow-x-auto">
{`GEMINI_API_KEY=AIza...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
VAST_ENDPOINT_URL=https://xxxx.vast.ai:PORT
VAST_API_KEY=your_vast_key`}
        </pre>
      </div>
    </div>
  );
}
