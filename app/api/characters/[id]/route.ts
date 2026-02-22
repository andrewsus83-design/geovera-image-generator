/**
 * app/api/characters/[id]/route.ts
 * GET /api/characters/:id — get character profile + skill evolution log
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { getCharacter, getSkillEvolutionLog } from "@/lib/characterApiClient";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const { id } = await params;

  try {
    const character = await getCharacter(id);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const evolutionLog = await getSkillEvolutionLog(id, 5);

    return NextResponse.json({ character, evolution_log: evolutionLog });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
