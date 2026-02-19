import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    // Build CLI args from form data
    const args: string[] = ["tiktok-ads"];

    const get = (k: string) => formData.get(k)?.toString() ?? "";

    args.push("--mode", get("mode") || "actor+prop");
    args.push("--actor-mode", get("actorMode") || "source");
    args.push("--gender", get("gender") || "female");
    args.push("--ethnicity", get("ethnicity") || "any");
    args.push("--age", get("age") || "20s");
    args.push("--screen", get("screen") || "9:16");
    args.push("--num-images", get("numImages") || "1");
    args.push("--color", get("color") || "none");
    args.push("--strength", get("strength") || "0.55");
    args.push("--seed", get("seed") || "42");
    args.push("--themes", get("themes") || "all");

    if (get("propDesc")) args.push("--prop-desc", get("propDesc"));
    if (get("propPosition")) args.push("--prop-position", get("propPosition"));
    if (get("propScale")) args.push("--prop-scale", get("propScale"));
    if (get("subject")) args.push("--subject", get("subject"));
    if (get("features")) args.push("--features", get("features"));

    if (get("useFlux") === "true") {
      args.push("--flux");
      args.push("--flux-variant", get("fluxVariant") || "dev");
    }

    if (get("continuity") === "true") {
      args.push("--continuity");
      args.push("--continuity-arc", get("continuityArc") || "journey");
    }

    if (get("serverless") === "true") {
      args.push("--serverless");
      if (get("vastEndpoint")) args.push("--vast-endpoint", get("vastEndpoint"));
      if (get("vastKey")) args.push("--vast-key", get("vastKey"));
      args.push("--gpu", get("gpu") || "any");
    }

    // Handle uploaded files — save to temp and pass path
    const actorFile = formData.get("actorSource") as File | null;
    const propFile = formData.get("propSource") as File | null;

    if (actorFile) {
      const buffer = Buffer.from(await actorFile.arrayBuffer());
      const tmpPath = path.join("/tmp", `actor_${Date.now()}_${actorFile.name}`);
      const { writeFileSync } = await import("fs");
      writeFileSync(tmpPath, buffer);
      args.push("--actor-source", tmpPath);
    }

    if (propFile) {
      const buffer = Buffer.from(await propFile.arrayBuffer());
      const tmpPath = path.join("/tmp", `prop_${Date.now()}_${propFile.name}`);
      const { writeFileSync } = await import("fs");
      writeFileSync(tmpPath, buffer);
      args.push("--prop-source", tmpPath);
      args.push("--prop-mode", "upload");
    }

    // Find project root (2 levels up from ui/)
    const projectRoot = path.join(process.cwd(), "..");
    const scriptPath = path.join(projectRoot, "scripts", "run_pipeline.py");

    console.log(`[generate] Running: python ${scriptPath} ${args.join(" ")}`);

    return new Promise<NextResponse>((resolve) => {
      let stdout = "";
      let stderr = "";

      const proc = spawn("python", [scriptPath, ...args], {
        cwd: projectRoot,
        env: { ...process.env },
      });

      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(NextResponse.json({ ok: true, total: args.includes("all") ? 30 : undefined, stdout }));
        } else {
          console.error("[generate] Error:", stderr);
          resolve(NextResponse.json({ error: stderr.slice(-500) || "Generation failed" }, { status: 500 }));
        }
      });

      proc.on("error", (err) => {
        resolve(NextResponse.json({ error: err.message }, { status: 500 }));
      });
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
