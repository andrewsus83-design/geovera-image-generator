/**
 * app/api/tasks/route.ts
 *
 * GET /api/tasks — list tasks (filter by job_id, client_id, character_id, status, date range)
 *
 * Query params:
 *   job_id        UUID    — filter by job
 *   client_id     UUID    — filter by client
 *   character_id  UUID    — filter by agent
 *   status        string  — pending|running|done|failed|skipped
 *   from          ISO     — created_at >= from
 *   to            ISO     — created_at <= to
 *   limit         number  — default 50, max 200
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

export async function GET(req: NextRequest) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const { searchParams } = new URL(req.url);
  const job_id       = searchParams.get("job_id");
  const client_id    = searchParams.get("client_id");
  const character_id = searchParams.get("character_id");
  const status       = searchParams.get("status");
  const from         = searchParams.get("from");
  const to           = searchParams.get("to");
  const limit        = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);

  const sb = getSb();
  let query = sb
    .from("tasks")
    .select("id,job_id,client_id,character_id,task_type,prompt,output,status,llm_used,cost_usd,scheduled_for,started_at,completed_at,error_msg,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (job_id)       query = query.eq("job_id", job_id);
  if (client_id)    query = query.eq("client_id", client_id);
  if (character_id) query = query.eq("character_id", character_id);
  if (status)       query = query.eq("status", status);
  if (from)         query = query.gte("created_at", from);
  if (to)           query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Summary stats
  const done    = (data ?? []).filter(t => t.status === "done").length;
  const failed  = (data ?? []).filter(t => t.status === "failed").length;
  const total_cost = (data ?? []).reduce((sum, t) => sum + (parseFloat(t.cost_usd) || 0), 0);

  return NextResponse.json({
    tasks: data,
    meta: {
      count:          (data ?? []).length,
      done,
      failed,
      total_cost_usd: Math.round(total_cost * 1e6) / 1e6,
    },
  });
}
