/**
 * app/api/characters/keys/route.ts
 * POST /api/characters/keys — create a new API key (returns plaintext once only)
 * GET  /api/characters/keys — list all keys (prefix + metadata, no secrets)
 *
 * Note: This endpoint uses a MASTER_API_KEY env var to bootstrap auth.
 * Set CHARACTERS_MASTER_KEY in Vercel env vars.
 */

import { NextRequest, NextResponse } from "next/server";
import { createApiKey, listApiKeys } from "@/lib/apiKeyAuth";

export const runtime = "nodejs";

function verifyMasterKey(req: NextRequest): boolean {
  const master = process.env.CHARACTERS_MASTER_KEY;
  if (!master) return false;

  const provided =
    req.headers.get("x-master-key") ??
    req.headers.get("authorization")?.replace("Bearer ", "") ??
    "";

  return provided === master;
}

export async function POST(req: NextRequest) {
  if (!verifyMasterKey(req)) {
    return NextResponse.json({ error: "Master key required" }, { status: 401 });
  }

  let label: string | undefined;
  try {
    const body = await req.json();
    label = body.label;
  } catch {
    // label is optional
  }

  try {
    const result = await createApiKey(label);
    return NextResponse.json(
      {
        message: "Save this key — it will not be shown again.",
        key: result.key,
        key_prefix: result.keyPrefix,
        id: result.id,
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!verifyMasterKey(req)) {
    return NextResponse.json({ error: "Master key required" }, { status: 401 });
  }

  try {
    const keys = await listApiKeys();
    return NextResponse.json({ keys });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
