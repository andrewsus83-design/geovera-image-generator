"use client";
import { useState } from "react";
import { Zap, Upload, Play, AlertCircle, CheckCircle, FolderOpen } from "lucide-react";

export default function TrainingPage() {
  const [tab, setTab] = useState<"actor" | "prop">("actor");
  const [imagesDir, setImagesDir] = useState("data/raw");
  const [outputDir, setOutputDir] = useState("output/lora");
  const [steps, setSteps] = useState(1000);
  const [lr, setLr] = useState("1e-4");
  const [rank, setRank] = useState(16);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<null | { ok: boolean; msg: string }>(null);

  const startTraining = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: tab, imagesDir, outputDir, steps, lr, rank }),
      });
      const d = await res.json();
      setResult({ ok: res.ok, msg: res.ok ? `Training started! Job ID: ${d.jobId}` : d.error });
    } catch {
      setResult({ ok: false, msg: "Failed to start training. Is the Python backend running?" });
    }
    setRunning(false);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-title-md font-bold text-black dark:text-white flex items-center gap-2">
          <Zap size={22} className="text-warning" />
          Training / LoRA
        </h1>
        <p className="text-sm text-body mt-1">
          Fine-tune LoRA adapters for actor identity or product consistency
        </p>
      </div>

      {/* Tabs */}
      <div className="flex rounded border border-stroke dark:border-strokedark overflow-hidden w-fit">
        {(["actor", "prop"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-2.5 text-sm font-medium transition-colors
              ${tab === t ? "bg-primary text-white" : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"}`}
          >
            {t === "actor" ? "Actor LoRA" : "Prop LoRA"}
          </button>
        ))}
      </div>

      <div className="card p-6 space-y-5">
        <div>
          <h2 className="font-semibold text-black dark:text-white text-sm mb-1">
            {tab === "actor" ? "Actor LoRA Training" : "Product LoRA Training"}
          </h2>
          <p className="text-xs text-body">
            {tab === "actor"
              ? "Upload 10-20 face/body images to train a LoRA that preserves actor identity across all themes"
              : "Upload 5-15 product images to train a LoRA for consistent product appearance in generated scenes"}
          </p>
        </div>

        {/* Image directory */}
        <div>
          <label className="form-label">Training Images Directory</label>
          <div className="flex gap-2">
            <input
              className="form-input flex-1"
              value={imagesDir}
              onChange={(e) => setImagesDir(e.target.value)}
              placeholder="data/raw/actor"
            />
            <button className="btn-secondary py-2 px-3">
              <FolderOpen size={15} />
            </button>
          </div>
          <p className="text-xs text-body mt-1">
            Recommended: 10-20 images, varied angles, consistent subject
          </p>
        </div>

        {/* Output path */}
        <div>
          <label className="form-label">Output LoRA Path</label>
          <input
            className="form-input"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            placeholder="output/lora/actor"
          />
        </div>

        {/* Hyperparameters */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="form-label">Training Steps</label>
            <input
              type="number"
              className="form-input"
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              min={100} max={5000}
            />
          </div>
          <div>
            <label className="form-label">Learning Rate</label>
            <select className="form-select" value={lr} onChange={(e) => setLr(e.target.value)}>
              <option value="1e-3">1e-3 (fast)</option>
              <option value="5e-4">5e-4</option>
              <option value="1e-4">1e-4 (default)</option>
              <option value="5e-5">5e-5 (careful)</option>
            </select>
          </div>
          <div>
            <label className="form-label">LoRA Rank</label>
            <select className="form-select" value={rank} onChange={(e) => setRank(Number(e.target.value))}>
              <option value={4}>4 (small)</option>
              <option value={8}>8</option>
              <option value={16}>16 (default)</option>
              <option value={32}>32 (large)</option>
              <option value={64}>64 (max)</option>
            </select>
          </div>
        </div>

        {/* Info box */}
        <div className="rounded border border-warning/20 bg-warning/5 p-4">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="text-warning flex-shrink-0 mt-0.5" />
            <div className="text-xs text-body space-y-1">
              <p className="font-medium text-black dark:text-white">Before training:</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Requires CUDA GPU with 16GB+ VRAM</li>
                <li>Install training deps: <code className="bg-gray dark:bg-meta-4 px-1 rounded">pip install bitsandbytes xformers</code></li>
                <li>Preprocess images first with Gemini captioning</li>
                <li>Estimated time: {steps < 500 ? "~30min" : steps < 1500 ? "~1-2hr" : "~3-5hr"} on RTX 4090</li>
              </ul>
            </div>
          </div>
        </div>

        <button
          onClick={startTraining}
          disabled={running || !imagesDir}
          className="btn-primary w-full py-3"
        >
          {running ? (
            <><div className="loader" style={{ width: 16, height: 16, borderWidth: 2 }} />Training in progress...</>
          ) : (
            <><Play size={16} />Start LoRA Training</>
          )}
        </button>

        {result && (
          <div className={`flex items-center gap-2 rounded border px-4 py-3 text-sm
            ${result.ok ? "border-success/30 bg-success/5 text-success" : "border-danger/30 bg-danger/5 text-danger"}`}>
            {result.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {result.msg}
          </div>
        )}
      </div>

      {/* Caption / Preprocess */}
      <div className="card p-6">
        <h2 className="font-semibold text-black dark:text-white text-sm mb-1">Pre-processing Tools</h2>
        <p className="text-xs text-body mb-4">Run Gemini captioning and image preprocessing before training</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secondary py-2.5 text-sm">
            <Upload size={14} />
            Caption with Gemini
          </button>
          <button className="btn-secondary py-2.5 text-sm">
            <Zap size={14} />
            Preprocess Images
          </button>
        </div>
      </div>
    </div>
  );
}
