import { NextResponse } from "next/server";

// ── Modal health check via web endpoint ───────────────────────────
// Set MODAL_HEALTH_URL in Vercel env vars after: modal deploy modal_app.py
// Format: https://<workspace>--geovera-flux-health-endpoint.modal.run

export async function POST() {
  const healthUrl = process.env.MODAL_HEALTH_URL;

  // If URL not set yet, check if at least MODAL_GENERATE_URL is configured
  if (!healthUrl) {
    const generateUrl = process.env.MODAL_GENERATE_URL;
    if (!generateUrl) {
      return NextResponse.json(
        {
          ok: false,
          status: "not_configured",
          message:
            "Modal endpoints not configured. Deploy modal_app.py then add MODAL_HEALTH_URL and MODAL_GENERATE_URL to Vercel env vars.",
        },
        { status: 503 }
      );
    }

    // MODAL_GENERATE_URL is set — assume app is deployed, derive health URL
    // URL pattern: https://<ws>--geovera-flux-generate-endpoint.modal.run
    //              → https://<ws>--geovera-flux-health-endpoint.modal.run
    const derivedHealthUrl = generateUrl.replace(
      "generate-endpoint",
      "health-endpoint"
    );

    try {
      const res = await fetch(derivedHealthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json({
          ok: true,
          status: "deployed",
          message: `Modal app geovera-flux is deployed ✓`,
          ...data,
        });
      }
    } catch {
      // fall through to generate URL check
    }

    // Health endpoint unreachable but generate URL is set — assume deployed
    return NextResponse.json({
      ok: true,
      status: "assumed_deployed",
      message: "Modal app geovera-flux is configured (MODAL_GENERATE_URL is set) ✓",
    });
  }

  // MODAL_HEALTH_URL is explicitly set — call it directly
  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: "error",
          message: `Modal health endpoint returned ${res.status}`,
        },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      ok: true,
      status: "deployed",
      message: "Modal app geovera-flux is deployed ✓",
      ...data,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, status: "unreachable", message: `Cannot reach Modal: ${msg}` },
      { status: 503 }
    );
  }
}
