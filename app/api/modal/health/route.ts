import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";

// ── Check Modal deployment status ─────────────────────────────────
function runModalAppList(env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const modal = spawn("modal", ["app", "list", "--json"], { env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    modal.stdout.on("data", (d) => (out += d.toString()));
    modal.stderr.on("data", (d) => (err += d.toString()));
    const timer = setTimeout(() => { modal.kill(); reject(new Error("Timeout")); }, 15000);
    modal.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err || `exit ${code}`));
    });
    modal.on("error", reject);
  });
}

export async function POST(req: NextRequest) {
  try {
    const { tokenId, tokenSecret } = await req.json();

    const modalEnv: Record<string, string> = {};
    if (tokenId)     modalEnv.MODAL_TOKEN_ID     = tokenId;
    if (tokenSecret) modalEnv.MODAL_TOKEN_SECRET  = tokenSecret;

    const raw = await runModalAppList(modalEnv);

    // Parse JSON array of apps
    let apps: { name: string; state: string; [key: string]: unknown }[] = [];
    try {
      apps = JSON.parse(raw);
    } catch {
      // Non-JSON output — try text parsing
      const deployed = raw.includes("geovera-flux");
      return NextResponse.json({
        ok: deployed,
        status: deployed ? "deployed" : "not_deployed",
        message: deployed
          ? "Modal app geovera-flux is deployed ✓"
          : "Modal app not found — run: modal deploy modal_app.py",
      });
    }

    const app = apps.find((a) => a.name === "geovera-flux");
    if (!app) {
      return NextResponse.json(
        {
          ok: false,
          status: "not_deployed",
          message: "Modal app not found — run: modal deploy modal_app.py",
        },
        { status: 404 }
      );
    }

    const isRunning = app.state === "deployed" || app.state === "running";
    return NextResponse.json({
      ok: isRunning,
      status: app.state,
      message: isRunning
        ? `Modal app geovera-flux is ${app.state} ✓`
        : `Modal app state: ${app.state}`,
      app,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";

    // If modal CLI not found, give helpful instructions
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      return NextResponse.json(
        {
          ok: false,
          status: "cli_not_found",
          message: "Modal CLI not installed on server. Run: pip install modal",
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
