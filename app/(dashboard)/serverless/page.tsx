"use client";
import { useState } from "react";
import { Cpu, CheckCircle, AlertCircle, RefreshCw, ExternalLink, Zap, TrendingUp } from "lucide-react";
import { GPU_CATALOG } from "@/lib/constants";
import type { GpuType } from "@/types";

export default function ServerlessPage() {
  const [endpoint, setEndpoint] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("vast_endpoint") || "https://run.vast.ai/12463" : "https://run.vast.ai/12463"
  );
  const [apiKey, setApiKey] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("vast_api_key") || "52b5d9042895c63b4bb2bf9aa660d168735c3df0ed9e33641adfcad36aaa4039" : "52b5d9042895c63b4bb2bf9aa660d168735c3df0ed9e33641adfcad36aaa4039"
  );
  const [gpu, setGpu] = useState<GpuType>("any");
  const [model, setModel] = useState<"flux_dev" | "flux_schnell" | "sdxl">("flux_schnell");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<null | { ok: boolean; msg: string }>(null);
  const [saved, setSaved] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/comfy/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint, apiKey }),
      });
      const d = await res.json();
      setTestResult({
        ok: res.ok,
        msg: res.ok
          ? `✅ Connected to ComfyUI! Worker is active.`
          : `❌ ${d.error || "Cannot connect — worker may still be loading"}`,
      });
    } catch {
      setTestResult({ ok: false, msg: "❌ Cannot reach endpoint. Check URL and key." });
    }
    setTesting(false);
  };

  const save = () => {
    localStorage.setItem("vast_endpoint", endpoint);
    localStorage.setItem("vast_api_key", apiKey);
    localStorage.setItem("vast_gpu", gpu);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const modelKey = model === "flux_dev" ? "flux_dev_s" : model === "flux_schnell" ? "flux_schnell_s" : "sdxl_s";

  // Cost table: 30 images
  const sampleImages = 30;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-title-md font-bold text-black dark:text-white flex items-center gap-2">
          <Cpu size={22} className="text-primary" />
          GPU & Serverless
        </h1>
        <p className="text-sm text-body mt-1">Configure vast.ai serverless endpoint and GPU preferences</p>
      </div>

      {/* Endpoint config */}
      <div className="card">
        <div className="border-b border-stroke dark:border-strokedark px-6 py-4 flex items-center justify-between">
          <h2 className="font-semibold text-black dark:text-white">vast.ai Serverless Connection</h2>
          <a
            href="https://vast.ai"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Open vast.ai <ExternalLink size={12} />
          </a>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="form-label">Endpoint URL</label>
            <input
              className="form-input"
              placeholder="https://xxxxx.vast.ai:PORT"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
            <p className="text-xs text-body mt-1">
              Format: <code className="bg-gray dark:bg-meta-4 px-1 rounded">https://run.vast.ai/&#123;endpoint_id&#125;</code> — your Endpoint ID is <strong>12463</strong>
            </p>
          </div>
          <div>
            <label className="form-label">API Key</label>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••••••••••••••"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={testConnection}
              disabled={!endpoint || testing}
              className="btn-secondary py-2 px-5 text-sm"
            >
              {testing ? (
                <><div className="loader" style={{ width: 14, height: 14, borderWidth: 2 }} />Testing...</>
              ) : (
                <><RefreshCw size={14} />Test Connection</>
              )}
            </button>
            <button
              onClick={save}
              disabled={!endpoint}
              className="btn-primary py-2 px-5 text-sm"
            >
              {saved ? <><CheckCircle size={14} />Saved!</> : "Save Settings"}
            </button>
          </div>

          {testResult && (
            <div className={`flex items-center gap-2 rounded border px-4 py-3 text-sm
              ${testResult.ok ? "border-success/30 bg-success/5 text-success" : "border-danger/30 bg-danger/5 text-danger"}`}>
              {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              {testResult.msg}
            </div>
          )}
        </div>
      </div>

      {/* GPU Comparison Table */}
      <div className="card">
        <div className="border-b border-stroke dark:border-strokedark px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold text-black dark:text-white">GPU Comparison</h2>
          <div className="flex gap-2">
            {(["flux_dev", "flux_schnell", "sdxl"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setModel(m)}
                className={`rounded px-3 py-1 text-xs font-medium transition-all
                  ${model === m ? "bg-primary text-white" : "bg-gray dark:bg-meta-4 text-body hover:text-black dark:hover:text-white"}`}
              >
                {m === "flux_dev" ? "Flux Dev" : m === "flux_schnell" ? "Flux Schnell" : "SDXL"}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-stroke dark:border-strokedark bg-gray dark:bg-meta-4">
                <th className="px-5 py-3 text-left text-xs font-semibold text-black dark:text-white">GPU</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-black dark:text-white">VRAM</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-black dark:text-white">$/hr</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-black dark:text-white">s/img</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-black dark:text-white">$/img</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-black dark:text-white">{sampleImages} imgs cost</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-black dark:text-white">Tier</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-black dark:text-white">Select</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(GPU_CATALOG).filter(([k]) => k !== "any").map(([key, g]) => {
                const spi = g[modelKey as keyof typeof g] as number | undefined;
                const costPerImg = spi && g.price_hr ? (spi / 3600) * g.price_hr : null;
                const totalCost = costPerImg ? costPerImg * sampleImages : null;
                const tierColors: Record<string, string> = {
                  budget: "badge-success", mid: "badge-warning", high: "badge-info",
                };
                return (
                  <tr key={key} className={`border-b border-stroke dark:border-strokedark hover:bg-gray dark:hover:bg-meta-4 transition-colors
                    ${gpu === key ? "bg-primary/5 dark:bg-primary/10" : ""}`}>
                    <td className="px-5 py-3">
                      <span className={`text-sm font-medium ${gpu === key ? "text-primary" : "text-black dark:text-white"}`}>
                        {g.name}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-sm text-body">{g.vram_gb}GB</td>
                    <td className="px-5 py-3 text-right text-sm text-body">${g.price_hr}</td>
                    <td className="px-5 py-3 text-right text-sm text-black dark:text-white font-medium">{spi ?? "—"}s</td>
                    <td className="px-5 py-3 text-right text-sm text-body">{costPerImg ? `$${costPerImg.toFixed(5)}` : "—"}</td>
                    <td className="px-5 py-3 text-right text-sm font-medium text-black dark:text-white">
                      {totalCost ? `$${totalCost.toFixed(4)}` : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={tierColors[g.tier] || "badge-info"}>{g.tier}</span>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => setGpu(key as GpuType)}
                        className={`rounded px-3 py-1 text-xs font-medium transition-all
                          ${gpu === key ? "bg-primary text-white" : "border border-stroke dark:border-strokedark text-body hover:border-primary hover:text-primary"}`}
                      >
                        {gpu === key ? "✓ Selected" : "Select"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 flex items-center gap-2 text-xs text-body border-t border-stroke dark:border-strokedark">
          <Zap size={12} className="text-warning" />
          Pricing estimates based on per-second billing. Actual costs depend on model load time and vast.ai market rates.
        </div>
      </div>

      {/* Tips */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={16} className="text-primary" />
          <h3 className="font-semibold text-black dark:text-white text-sm">GPU Selection Guide</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { tier: "Budget", gpu: "RTX 3090 / 3090 Ti", use: "Testing, low-volume batches, schnell model", color: "border-success/30 bg-success/5" },
            { tier: "Mid-Range", gpu: "RTX 4090 / 5090", use: "Production ads, Flux dev model, 30-theme batches", color: "border-warning/30 bg-warning/5" },
            { tier: "High-End", gpu: "A100 / H100", use: "Fastest throughput, high-volume commercial campaigns", color: "border-primary/30 bg-primary/5" },
          ].map((t) => (
            <div key={t.tier} className={`rounded border p-4 ${t.color}`}>
              <p className="text-sm font-semibold text-black dark:text-white">{t.tier}</p>
              <p className="text-xs text-body mt-0.5 font-medium">{t.gpu}</p>
              <p className="text-xs text-body mt-1">{t.use}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
