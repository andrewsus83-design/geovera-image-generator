"use client";
import { useState } from "react";
import {
  Film, User, Package, Users, Cpu, Shuffle, Play, ChevronDown, ChevronRight,
  Info, CheckCircle, Clock, AlertCircle, Loader,
} from "lucide-react";
import type { GenerationMode, ActorMode, PropMode, ScreenRatio, ContinuityArc, GpuType } from "@/types";
import {
  SCREEN_RATIOS, ETHNICITIES, AGE_RANGES, FEATURES, PROP_POSITIONS,
  CONTINUITY_ARCS, GPU_CATALOG,
} from "@/lib/constants";
import ThemeSelector from "@/components/TikTokAds/ThemeSelector";
import ColorPicker from "@/components/TikTokAds/ColorPicker";
import ImageUpload from "@/components/TikTokAds/ImageUpload";

type Section = "mode" | "actor" | "prop" | "themes" | "settings" | "continuity" | "serverless";

export default function TikTokAdsPage() {
  // Mode
  const [mode, setMode] = useState<GenerationMode>("actor+prop");

  // Actor
  const [actorMode, setActorMode] = useState<ActorMode>("source");
  const [actorFile, setActorFile] = useState<File | null>(null);
  const [gender, setGender] = useState("female");
  const [ethnicity, setEthnicity] = useState("any");
  const [age, setAge] = useState("20s");
  const [features, setFeatures] = useState<string[]>([]);
  const [subject, setSubject] = useState("");

  // Prop
  const [propMode, setPropMode] = useState<PropMode>("upload");
  const [propFile, setPropFile] = useState<File | null>(null);
  const [propDesc, setPropDesc] = useState("");
  const [propPosition, setPropPosition] = useState("center-bottom");
  const [propScale, setPropScale] = useState(0.35);

  // Generation
  const [selectedThemes, setSelectedThemes] = useState<number>(1);
  const [screen, setScreen] = useState<ScreenRatio>("9:16");
  const [numImages, setNumImages] = useState(1);
  const [color, setColor] = useState("none");
  const [strength, setStrength] = useState(0.55);
  const [seed, setSeed] = useState(42);
  const [useFlux, setUseFlux] = useState(true);
  const [fluxVariant, setFluxVariant] = useState<"dev" | "schnell">("dev");

  // Continuity
  const [continuity, setContinuity] = useState(false);
  const [continuityArc, setContinuityArc] = useState<ContinuityArc>("journey");

  // Serverless
  const [serverless, setServerless] = useState(true);
  const [vastEndpoint, setVastEndpoint] = useState("");
  const [vastKey, setVastKey] = useState("");
  const [gpu, setGpu] = useState<GpuType>("any");

  // UI state
  const [open, setOpen] = useState<Record<Section, boolean>>({
    mode: true, actor: true, prop: true, themes: true,
    settings: true, continuity: false, serverless: true,
  });
  const [jobStatus, setJobStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [jobMsg, setJobMsg] = useState("");
  const [progress, setProgress] = useState(0);

  const toggleSection = (s: Section) => setOpen((p) => ({ ...p, [s]: !p[s] }));
  const toggleFeature = (f: string) =>
    setFeatures((p) => p.includes(f) ? p.filter((x) => x !== f) : [...p, f]);

  const hasActor = mode === "actor" || mode === "actor+prop";
  const hasProp = mode === "prop" || mode === "actor+prop";
  const totalImages = numImages;

  const gpuInfo = GPU_CATALOG[gpu];
  const modelKey = useFlux ? (fluxVariant === "dev" ? "flux_dev_s" : "flux_schnell_s") : "sdxl_s";
  const secPerImg = gpu !== "any" && gpuInfo[modelKey as keyof typeof gpuInfo]
    ? (gpuInfo[modelKey as keyof typeof gpuInfo] as number)
    : null;
  const estSecs = secPerImg ? totalImages * secPerImg : null;
  const estCost = secPerImg && gpuInfo.price_hr
    ? ((totalImages * secPerImg / 3600) * gpuInfo.price_hr).toFixed(4)
    : null;

  const handleGenerate = async () => {
    setJobStatus("running");
    setProgress(0);
    setJobMsg("Starting generation...");

    const formData = new FormData();
    formData.append("mode", mode);
    formData.append("actorMode", actorMode);
    if (actorFile) formData.append("actorSource", actorFile);
    formData.append("gender", gender);
    formData.append("ethnicity", ethnicity);
    formData.append("age", age);
    formData.append("features", features.join(","));
    if (subject) formData.append("subject", subject);
    if (propFile) formData.append("propSource", propFile);
    formData.append("propMode", propMode);
    formData.append("propDesc", propDesc);
    formData.append("propPosition", propPosition);
    formData.append("propScale", String(propScale));
    formData.append("themes", String(selectedThemes));
    formData.append("screen", screen);
    formData.append("numImages", String(numImages));
    formData.append("color", color);
    formData.append("strength", String(strength));
    formData.append("seed", String(seed));
    formData.append("useFlux", String(useFlux));
    formData.append("fluxVariant", fluxVariant);
    formData.append("continuity", String(continuity));
    formData.append("continuityArc", continuityArc);
    formData.append("serverless", String(serverless));
    formData.append("vastEndpoint", vastEndpoint);
    formData.append("vastKey", vastKey);
    formData.append("gpu", gpu);

    try {
      const res = await fetch("/api/generate", { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setJobStatus("done");
        setProgress(100);
        setJobMsg(`✓ Done! ${data.total ?? totalImages} images generated.`);
      } else {
        throw new Error(data.error || "Generation failed");
      }
    } catch (err: unknown) {
      setJobStatus("error");
      setJobMsg(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const Section = ({ id, title, icon, children }: { id: Section; title: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="card overflow-hidden">
      <button
        onClick={() => toggleSection(id)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-primary">{icon}</span>
          <span className="font-semibold text-black dark:text-white">{title}</span>
        </div>
        {open[id] ? <ChevronDown size={16} className="text-body" /> : <ChevronRight size={16} className="text-body" />}
      </button>
      {open[id] && (
        <div className="border-t border-stroke dark:border-strokedark px-5 py-5">
          {children}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-title-md font-bold text-black dark:text-white flex items-center gap-2">
            <Film size={22} className="text-primary" />
            TikTok Ad Generator
          </h1>
          <p className="text-sm text-body mt-1">
            Generate 30-theme commercial ads · Actor · Prop · Actor+Prop
          </p>
        </div>

        {/* Cost estimate */}
        {serverless && (
          <div className="rounded border border-stroke dark:border-strokedark bg-white dark:bg-boxdark px-4 py-3 text-right">
            <p className="text-xs text-body">Estimated</p>
            <p className="text-base font-bold text-black dark:text-white">
              {estCost ? `$${estCost}` : "—"}
            </p>
            <p className="text-xs text-body">
              {estSecs ? `~${Math.ceil(estSecs / 60)}m · ${totalImages} img` : `${totalImages} images`}
            </p>
          </div>
        )}
      </div>

      {/* Job status bar */}
      {jobStatus !== "idle" && (
        <div className={`flex items-center gap-3 rounded border px-4 py-3
          ${jobStatus === "running" ? "border-warning/30 bg-warning/5" : ""}
          ${jobStatus === "done" ? "border-success/30 bg-success/5" : ""}
          ${jobStatus === "error" ? "border-danger/30 bg-danger/5" : ""}
        `}>
          {jobStatus === "running" && <div className="loader flex-shrink-0" />}
          {jobStatus === "done" && <CheckCircle size={18} className="flex-shrink-0 text-success" />}
          {jobStatus === "error" && <AlertCircle size={18} className="flex-shrink-0 text-danger" />}
          <span className={`text-sm font-medium
            ${jobStatus === "running" ? "text-warning" : ""}
            ${jobStatus === "done" ? "text-success" : ""}
            ${jobStatus === "error" ? "text-danger" : ""}
          `}>{jobMsg}</span>
          {jobStatus === "running" && (
            <div className="ml-auto flex-shrink-0 text-xs text-body">{progress}%</div>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Left column */}
        <div className="xl:col-span-2 space-y-4">

          {/* 1. Generation Mode */}
          <Section id="mode" title="Generation Mode" icon={<Shuffle size={18} />}>
            <div className="grid grid-cols-3 gap-3">
              {([
                { v: "actor", label: "Actor Only", desc: "Person in themed scenes", icon: <User size={20} /> },
                { v: "prop", label: "Prop Only", desc: "Product in themed scenes", icon: <Package size={20} /> },
                { v: "actor+prop", label: "Actor + Prop", desc: "Person with product", icon: <Users size={20} /> },
              ] as { v: GenerationMode; label: string; desc: string; icon: React.ReactNode }[]).map((m) => (
                <button
                  key={m.v}
                  onClick={() => setMode(m.v)}
                  className={`flex flex-col items-center gap-2 rounded border-2 p-4 text-center transition-all
                    ${mode === m.v ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                >
                  <span className={mode === m.v ? "text-primary" : "text-body"}>{m.icon}</span>
                  <span className={`text-sm font-semibold ${mode === m.v ? "text-primary" : "text-black dark:text-white"}`}>{m.label}</span>
                  <span className="text-xs text-body">{m.desc}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* 2. Actor Config */}
          {hasActor && (
            <Section id="actor" title="Actor Configuration" icon={<User size={18} />}>
              {/* Actor Mode tabs */}
              <div className="flex rounded border border-stroke dark:border-strokedark overflow-hidden mb-5">
                {([
                  { v: "source", label: "Upload Face" },
                  { v: "trained", label: "LoRA Trained" },
                  { v: "random", label: "Random" },
                ] as { v: ActorMode; label: string }[]).map((m) => (
                  <button
                    key={m.v}
                    onClick={() => setActorMode(m.v)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors
                      ${actorMode === m.v ? "bg-primary text-white" : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {actorMode === "source" && (
                <ImageUpload
                  label="Actor Face / Body Image"
                  hint="Upload a reference image to maintain face/body identity across all themes"
                  value={actorFile}
                  onChange={setActorFile}
                />
              )}
              {actorMode === "trained" && (
                <div>
                  <label className="form-label">LoRA Weights Path</label>
                  <input className="form-input" placeholder="./output/lora/actor" />
                </div>
              )}

              <div className="mt-4 grid grid-cols-3 gap-4">
                <div>
                  <label className="form-label">Gender</label>
                  <select className="form-select" value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="non_binary">Non-binary</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Ethnicity</label>
                  <select className="form-select" value={ethnicity} onChange={(e) => setEthnicity(e.target.value)}>
                    {ETHNICITIES.map((e) => (
                      <option key={e.value} value={e.value}>{e.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Age Range</label>
                  <select className="form-select" value={age} onChange={(e) => setAge(e.target.value)}>
                    {AGE_RANGES.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Features */}
              <div className="mt-4">
                <label className="form-label">Features (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {FEATURES.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => toggleFeature(f.value)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-all
                        ${features.includes(f.value)
                          ? "border-primary bg-primary text-white"
                          : "border-stroke dark:border-strokedark text-body hover:border-primary"
                        }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom subject */}
              <div className="mt-4">
                <label className="form-label">Custom Subject Description <span className="text-body font-normal">(overrides above)</span></label>
                <input
                  className="form-input"
                  placeholder="e.g. elegant Asian woman in her 30s with straight hair"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            </Section>
          )}

          {/* 3. Prop Config */}
          {hasProp && (
            <Section id="prop" title="Prop Configuration" icon={<Package size={18} />}>
              <div className="flex rounded border border-stroke dark:border-strokedark overflow-hidden mb-5">
                {([
                  { v: "upload", label: "Upload Product" },
                  { v: "trained", label: "LoRA Trained" },
                ] as { v: PropMode; label: string }[]).map((m) => (
                  <button
                    key={m.v}
                    onClick={() => setPropMode(m.v)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors
                      ${propMode === m.v ? "bg-primary text-white" : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {propMode === "upload" && (
                <ImageUpload
                  label="Product Image"
                  hint="The product will be composited into the generated scene"
                  value={propFile}
                  onChange={setPropFile}
                />
              )}

              <div className="mt-4">
                <label className="form-label">Product Description <span className="text-danger">*</span></label>
                <input
                  className="form-input"
                  placeholder='e.g. "premium skincare serum bottle" or "luxury handbag"'
                  value={propDesc}
                  onChange={(e) => setPropDesc(e.target.value)}
                />
              </div>

              {propMode === "upload" && (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Prop Position</label>
                    <select className="form-select" value={propPosition} onChange={(e) => setPropPosition(e.target.value)}>
                      {PROP_POSITIONS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Prop Scale — {Math.round(propScale * 100)}%</label>
                    <input
                      type="range"
                      min={0.1} max={0.8} step={0.05}
                      value={propScale}
                      onChange={(e) => setPropScale(Number(e.target.value))}
                      className="w-full mt-2 accent-primary"
                    />
                    <div className="flex justify-between text-xs text-body mt-1">
                      <span>Small 10%</span><span>Large 80%</span>
                    </div>
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* 4. Themes */}
          <Section id="themes" title="Ad Themes" icon={<Film size={18} />}>
            <ThemeSelector selected={selectedThemes} onChange={setSelectedThemes} />
          </Section>

          {/* 5. Generation Settings */}
          <Section id="settings" title="Generation Settings" icon={<Info size={18} />}>
            {/* Screen ratio */}
            <div className="mb-5">
              <label className="form-label">Screen Ratio</label>
              <div className="grid grid-cols-5 gap-2">
                {Object.entries(SCREEN_RATIOS).map(([key, r]) => (
                  <button
                    key={key}
                    onClick={() => setScreen(key as ScreenRatio)}
                    className={`rounded border p-2 text-center text-xs transition-all
                      ${screen === key ? "border-primary bg-primary/5 text-primary font-semibold" : "border-stroke dark:border-strokedark text-body hover:border-primary/50"}`}
                  >
                    <div className="font-bold">{key}</div>
                    <div className="mt-0.5 text-[10px] leading-tight">{r.width}×{r.height}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Color palette */}
            <div className="mb-5">
              <ColorPicker value={color} onChange={setColor} />
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="form-label">Images per Theme</label>
                <input
                  type="number" min={1} max={4}
                  className="form-input"
                  value={numImages}
                  onChange={(e) => setNumImages(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="form-label">Seed</label>
                <input
                  type="number"
                  className="form-input"
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Strength slider */}
            <div className="mb-4">
              <label className="form-label">Variation Strength — {strength.toFixed(2)}</label>
              <input
                type="range" min={0.1} max={1.0} step={0.05}
                value={strength}
                onChange={(e) => setStrength(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-body mt-1">
                <span>0.1 (similar to source)</span><span>1.0 (completely new)</span>
              </div>
            </div>

            {/* Model selection */}
            <div>
              <label className="form-label">Model</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setUseFlux(true)}
                  className={`rounded border p-3 text-sm text-left transition-all
                    ${useFlux ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                >
                  <p className={`font-semibold ${useFlux ? "text-primary" : "text-black dark:text-white"}`}>Flux.1</p>
                  <p className="text-xs text-body mt-1">Best quality · 24GB VRAM</p>
                  {useFlux && (
                    <div className="mt-2 flex gap-2">
                      {(["dev", "schnell"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={(e) => { e.stopPropagation(); setFluxVariant(v); }}
                          className={`rounded px-2 py-0.5 text-xs font-medium transition-all
                            ${fluxVariant === v ? "bg-primary text-white" : "bg-gray dark:bg-meta-4 text-body"}`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                </button>
                <button
                  onClick={() => setUseFlux(false)}
                  className={`rounded border p-3 text-sm text-left transition-all
                    ${!useFlux ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                >
                  <p className={`font-semibold ${!useFlux ? "text-primary" : "text-black dark:text-white"}`}>SDXL</p>
                  <p className="text-xs text-body mt-1">Faster · 8GB+ VRAM</p>
                </button>
              </div>
            </div>
          </Section>

          {/* 6. Continuity */}
          <Section id="continuity" title="Continuity / Storytelling" icon={<Film size={18} />}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-medium text-black dark:text-white">Enable Visual Storytelling</p>
                <p className="text-xs text-body mt-0.5">Images form a narrative arc instead of independent shots</p>
              </div>
              <button
                onClick={() => setContinuity(!continuity)}
                className={`relative h-6 w-11 rounded-full transition-colors ${continuity ? "bg-primary" : "bg-stroke dark:bg-strokedark"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${continuity ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>

            {continuity && (
              <div className="grid grid-cols-2 gap-3">
                {(Object.entries(CONTINUITY_ARCS) as [ContinuityArc, typeof CONTINUITY_ARCS[string]][]).map(([key, arc]) => (
                  <button
                    key={key}
                    onClick={() => setContinuityArc(key)}
                    className={`rounded border p-3 text-left transition-all
                      ${continuityArc === key ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                  >
                    <p className={`text-sm font-semibold ${continuityArc === key ? "text-primary" : "text-black dark:text-white"}`}>{arc.label}</p>
                    <p className="text-xs text-body mt-1">{arc.description}</p>
                  </button>
                ))}
              </div>
            )}
          </Section>

        </div>

        {/* Right column — Serverless + Generate */}
        <div className="space-y-4">

          {/* Serverless config */}
          <Section id="serverless" title="vast.ai Serverless" icon={<Cpu size={18} />}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-medium text-black dark:text-white">Use Serverless GPU</p>
                <p className="text-xs text-body mt-0.5">No local GPU required</p>
              </div>
              <button
                onClick={() => setServerless(!serverless)}
                className={`relative h-6 w-11 rounded-full transition-colors ${serverless ? "bg-primary" : "bg-stroke dark:bg-strokedark"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${serverless ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>

            {serverless && (
              <>
                <div className="mb-3">
                  <label className="form-label">Endpoint URL</label>
                  <input
                    className="form-input"
                    placeholder="https://your-endpoint.vast.ai"
                    value={vastEndpoint}
                    onChange={(e) => setVastEndpoint(e.target.value)}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">API Key</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="••••••••••••"
                    value={vastKey}
                    onChange={(e) => setVastKey(e.target.value)}
                  />
                </div>

                {/* GPU selector */}
                <div>
                  <label className="form-label">GPU Type</label>
                  <div className="space-y-1.5">
                    {Object.entries(GPU_CATALOG).map(([key, g]) => {
                      const spi = g[modelKey as keyof typeof g] as number | undefined;
                      const costPer = spi && g.price_hr ? ((spi / 3600) * g.price_hr).toFixed(5) : null;
                      return (
                        <button
                          key={key}
                          onClick={() => setGpu(key as GpuType)}
                          className={`w-full rounded border p-2.5 text-left transition-all
                            ${gpu === key ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-sm font-medium ${gpu === key ? "text-primary" : "text-black dark:text-white"}`}>{g.name}</span>
                            <div className="text-right">
                              {g.price_hr && <span className="text-xs text-body">${g.price_hr}/hr</span>}
                              {!g.price_hr && <span className="text-xs text-success">Auto</span>}
                            </div>
                          </div>
                          {g.vram_gb && (
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-xs text-body">{g.vram_gb}GB VRAM · {g.tier}</span>
                              {spi && <span className="text-xs text-body">{spi}s/img{costPer && ` · $${costPer}`}</span>}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </Section>

          {/* Generate summary card */}
          <div className="card p-5 space-y-3">
            <h3 className="font-semibold text-black dark:text-white text-sm">Generation Summary</h3>

            <div className="space-y-1.5 text-xs">
              {[
                { label: "Mode", value: mode.toUpperCase() },
                { label: "Model", value: useFlux ? `Flux.1 ${fluxVariant}` : "SDXL" },
                { label: "Screen", value: `${screen} (${SCREEN_RATIOS[screen].width}×${SCREEN_RATIOS[screen].height})` },
                { label: "Images", value: `${totalImages} image${totalImages > 1 ? "s" : ""} from theme #${selectedThemes}` },
                { label: "Strength", value: strength.toFixed(2) },
                { label: "Continuity", value: continuity ? `✓ ${CONTINUITY_ARCS[continuityArc].label}` : "Off" },
                { label: "Backend", value: serverless ? "vast.ai Serverless" : "Local GPU" },
                ...(serverless && gpu !== "any" ? [
                  { label: "GPU", value: GPU_CATALOG[gpu].name },
                  ...(estSecs ? [{ label: "Est. Time", value: `~${Math.ceil(estSecs / 60)}m` }] : []),
                  ...(estCost ? [{ label: "Est. Cost", value: `$${estCost}` }] : []),
                ] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-2">
                  <span className="text-body flex-shrink-0">{label}</span>
                  <span className="font-medium text-black dark:text-white text-right">{value}</span>
                </div>
              ))}
            </div>

            <button
              onClick={handleGenerate}
              disabled={jobStatus === "running"}
              className="btn-primary w-full mt-2 py-3"
            >
              {jobStatus === "running" ? (
                <>
                  <div className="loader" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Generating...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Generate {totalImages} Images
                </>
              )}
            </button>

            {jobStatus === "done" && (
              <a href="/gallery" className="btn-success w-full text-center block py-2.5 rounded text-sm font-medium">
                View in Gallery →
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
