/**
 * app/api/reports/route.ts
 *
 * POST /api/reports       — generate a report for a client (calls Modal to summarize)
 * GET  /api/reports       — list reports (filter by client_id, report_type, date range)
 *
 * Body (POST):
 *   client_id    string   required
 *   report_type  string   optional — "daily"|"weekly"|"monthly"|"on_demand" (default: daily)
 *   report_date  string   optional — ISO date (default: today)
 *   title        string   optional — override auto-generated title
 *
 * Flow:
 *   1. Load all done tasks for client within report period
 *   2. Call Modal /chat (analyst character or default) to generate summary
 *   3. Save report with sections per agent/job
 *   4. Return report
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { createClient } from "@supabase/supabase-js";

export const runtime    = "nodejs";
export const maxDuration = 120;

function getSb() {
  return createClient(
    process.env.SUPABASE_CHAR_URL!,
    process.env.SUPABASE_CHAR_SERVICE_KEY!,
  );
}

function periodRange(reportType: string, reportDate: string): { from: string; to: string } {
  const date = new Date(reportDate);
  let from: Date;
  const to = new Date(date);
  to.setHours(23, 59, 59, 999);

  switch (reportType) {
    case "weekly":
      from = new Date(date);
      from.setDate(from.getDate() - 7);
      break;
    case "monthly":
      from = new Date(date);
      from.setMonth(from.getMonth() - 1);
      break;
    default: // daily + on_demand
      from = new Date(date);
      from.setHours(0, 0, 0, 0);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function POST(req: NextRequest) {
  const rawKey = req.headers.get("authorization") ?? req.headers.get("x-api-key") ?? "";
  try {
    await validateApiKey(rawKey);
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const { client_id, report_type = "daily" } = body as Record<string, string>;
  const report_date = (body.report_date as string) ?? new Date().toISOString().split("T")[0];

  if (!client_id) return NextResponse.json({ error: "client_id is required" }, { status: 400 });

  const sb = getSb();

  // Load client
  const { data: client } = await sb.from("clients").select("name,company,goals").eq("id", client_id).single();
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  // Load tasks for period
  const { from, to } = periodRange(report_type as string, report_date);
  const { data: tasks } = await sb
    .from("tasks")
    .select("id,job_id,character_id,task_type,prompt,output,status,llm_used,cost_usd,completed_at,characters(name,gender), jobs(title,role,objective)")
    .eq("client_id", client_id)
    .eq("status", "done")
    .gte("created_at", from)
    .lte("created_at", to)
    .order("completed_at");

  const doneTasks  = tasks ?? [];
  const total_cost = doneTasks.reduce((s, t) => s + (parseFloat(t.cost_usd) || 0), 0);

  // Build sections per job
  const sectionMap: Record<string, { job_title: string; role: string; character: string; outputs: string[] }> = {};
  for (const t of doneTasks) {
    const jid = t.job_id as string;
    if (!sectionMap[jid]) {
      const jobs = t.jobs as unknown as Record<string, string> | null;
      const chars = t.characters as unknown as Record<string, string> | null;
      sectionMap[jid] = {
        job_title: jobs?.title ?? "Job",
        role:      jobs?.role ?? "",
        character: chars?.name ?? "Agent",
        outputs:   [],
      };
    }
    if (t.output) sectionMap[jid].outputs.push(t.output);
  }
  const sections = Object.values(sectionMap);

  // Call Modal for executive summary (use analyst role if available, else default)
  let summary = "";
  const modalBase = process.env.MODAL_CHAR_AGENT_BASE_URL ?? "";
  const apiKey    = rawKey.replace("Bearer ", "");

  if (modalBase && doneTasks.length > 0) {
    const summaryPrompt = [
      `You are a business analyst. Write a concise executive summary for ${client.name ?? "the client"}.`,
      `Period: ${from.split("T")[0]} to ${to.split("T")[0]}`,
      `Goals: ${(client.goals ?? []).join(", ") || "not specified"}`,
      ``,
      `Agent outputs this period:`,
      sections.map(s => `### ${s.character} (${s.role})\n${s.outputs.join("\n---\n")}`).join("\n\n"),
      ``,
      `Write a 3-5 bullet executive summary of progress, highlights, and next priorities.`,
    ].join("\n");

    try {
      // Use any available character as "analyst" for summary — or call Modal directly
      const firstChar = doneTasks[0]?.character_id as string;
      if (firstChar) {
        const res = await fetch(`${modalBase}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
          body: JSON.stringify({ character_id: firstChar, message: summaryPrompt, save_to_db: false }),
        });
        if (res.ok) {
          const r = await res.json() as { reply?: string };
          summary = r.reply ?? "";
        }
      }
    } catch { /* summary stays empty */ }
  }

  if (!summary && sections.length > 0) {
    summary = sections.map(s => `• ${s.character} (${s.role}): ${s.outputs[0]?.slice(0, 200) ?? "no output"}`).join("\n");
  }

  const title = (body.title as string) ?? `${report_type.charAt(0).toUpperCase() + report_type.slice(1)} Report — ${client.name} — ${report_date}`;

  // Upsert report (unique on client_id + report_date + report_type)
  const { data: report, error: repErr } = await sb
    .from("reports")
    .upsert({
      client_id,
      report_date,
      report_type,
      title,
      summary,
      sections,
      tasks_completed: doneTasks.filter(t => t.status === "done").length,
      tasks_failed:    0,
      total_cost_usd:  Math.round(total_cost * 1e6) / 1e6,
      status:          "published",
    }, { onConflict: "client_id,report_date,report_type" })
    .select("*")
    .single();

  if (repErr) return NextResponse.json({ error: repErr.message }, { status: 500 });
  return NextResponse.json({ report }, { status: 201 });
}

export async function GET(req: NextRequest) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const { searchParams } = new URL(req.url);
  const client_id   = searchParams.get("client_id");
  const report_type = searchParams.get("report_type");
  const from        = searchParams.get("from");
  const to          = searchParams.get("to");
  const limit       = Math.min(parseInt(searchParams.get("limit") ?? "20"), 100);

  const sb = getSb();
  let query = sb
    .from("reports")
    .select("id,client_id,report_date,report_type,title,summary,tasks_completed,tasks_failed,total_cost_usd,status,created_at")
    .order("report_date", { ascending: false })
    .limit(limit);

  if (client_id)   query = query.eq("client_id", client_id);
  if (report_type) query = query.eq("report_type", report_type);
  if (from)        query = query.gte("report_date", from);
  if (to)          query = query.lte("report_date", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data });
}
