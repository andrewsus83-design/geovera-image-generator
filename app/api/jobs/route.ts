/**
 * app/api/jobs/route.ts
 *
 * POST /api/jobs — create a new job (hire an agent for a client)
 * GET  /api/jobs — list jobs (filter by client_id, character_id, status)
 *
 * Body (POST):
 *   client_id     string  required
 *   character_id  string  required — the agent UUID
 *   title         string  required — e.g. "CMO for Acme Corp"
 *   role          string  required — must match ROLE_LLM_MAP key (ceo/cmo/cto/etc.)
 *   objective     string  required — what this agent must achieve
 *   instructions  string  optional — detailed context/briefing
 *   schedule      string  optional — "daily"|"weekly"|"hourly"|"on_demand" (default: daily)
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const VALID_ROLES = ["ceo","cmo","cto","developer","engineer","sales","creator","analyst","host","designer","support"];
const VALID_SCHEDULES = ["hourly","daily","weekly","on_demand"];

function getSb() {
  return createClient(
    process.env.SUPABASE_CHAR_URL!,
    process.env.SUPABASE_CHAR_SERVICE_KEY!,
  );
}

function nextRunAt(schedule: string): string {
  const now = new Date();
  switch (schedule) {
    case "hourly":  now.setHours(now.getHours() + 1); break;
    case "daily":   now.setDate(now.getDate() + 1); now.setHours(9, 0, 0, 0); break;
    case "weekly":  now.setDate(now.getDate() + 7); now.setHours(9, 0, 0, 0); break;
    case "on_demand": return new Date(8640000000000000).toISOString(); // far future = manual only
  }
  return now.toISOString();
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

  const { client_id, character_id, title, role, objective, instructions, schedule = "daily" } = body as Record<string, string>;

  if (!client_id || !character_id || !title || !role || !objective) {
    return NextResponse.json({ error: "Required: client_id, character_id, title, role, objective" }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` }, { status: 400 });
  }
  if (!VALID_SCHEDULES.includes(schedule)) {
    return NextResponse.json({ error: `schedule must be one of: ${VALID_SCHEDULES.join(", ")}` }, { status: 400 });
  }

  const sb = getSb();

  // Verify client + character exist
  const [clientCheck, charCheck] = await Promise.all([
    sb.from("clients").select("id").eq("id", client_id).single(),
    sb.from("characters").select("id").eq("id", character_id).single(),
  ]);
  if (!clientCheck.data) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (!charCheck.data)   return NextResponse.json({ error: "Character not found" }, { status: 404 });

  const { data, error } = await sb
    .from("jobs")
    .insert({
      client_id, character_id, title, role, objective,
      instructions: instructions ?? null,
      schedule,
      next_run_at: nextRunAt(schedule),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also add character to client's assigned_agents if not already there (best effort)
  void sb.rpc("array_append_unique", { table_name: "clients", row_id: client_id, col: "assigned_agents", val: character_id })
    .then(() => {});

  return NextResponse.json({ job: data }, { status: 201 });
}

export async function GET(req: NextRequest) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const { searchParams } = new URL(req.url);
  const client_id    = searchParams.get("client_id");
  const character_id = searchParams.get("character_id");
  const status       = searchParams.get("status");

  const sb = getSb();
  let query = sb.from("jobs").select("*, clients(name,company), characters(name,gender,ethnicity)").order("created_at", { ascending: false });
  if (client_id)    query = query.eq("client_id", client_id);
  if (character_id) query = query.eq("character_id", character_id);
  if (status)       query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ jobs: data });
}
