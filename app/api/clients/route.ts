/**
 * app/api/clients/route.ts
 *
 * POST /api/clients — onboard a new client
 * GET  /api/clients — list all clients
 *
 * Body (POST):
 *   name           string   required
 *   company        string   optional
 *   industry       string   optional
 *   goals          string[] optional  — e.g. ["increase revenue", "expand market"]
 *   context_data   object   optional  — ingested data from step 1+2 (research, docs)
 *   assigned_agents string[] optional — character UUIDs to assign
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSb() {
  return createClient(
    process.env.SUPABASE_CHAR_URL!,
    process.env.SUPABASE_CHAR_SERVICE_KEY!,
  );
}

export async function POST(req: NextRequest) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name (string) is required" }, { status: 400 });
  }

  const sb = getSb();
  const { data, error } = await sb
    .from("clients")
    .insert({
      name:            body.name,
      company:         body.company ?? null,
      industry:        body.industry ?? null,
      goals:           body.goals ?? [],
      context_data:    body.context_data ?? {},
      assigned_agents: body.assigned_agents ?? [],
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data }, { status: 201 });
}

export async function GET(req: NextRequest) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // filter by status

  const sb = getSb();
  let query = sb.from("clients").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data });
}
