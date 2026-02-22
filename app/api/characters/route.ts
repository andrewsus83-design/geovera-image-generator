/**
 * app/api/characters/route.ts
 * POST  /api/characters — register a character from character_profile.json
 * GET   /api/characters — list all characters
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { registerCharacter, listCharacters } from "@/lib/characterApiClient";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name || !body.gender || !body.ethnicity || !body.age) {
    return NextResponse.json(
      { error: "Required fields: name, gender, ethnicity, age" },
      { status: 400 },
    );
  }

  try {
    const character = await registerCharacter(body);
    return NextResponse.json({ character }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  try {
    const characters = await listCharacters();
    return NextResponse.json({ characters });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
