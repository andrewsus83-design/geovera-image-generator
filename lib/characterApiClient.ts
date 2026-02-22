/**
 * lib/characterApiClient.ts
 * Supabase client + Modal URL helpers for Character AI Agent system.
 */

import { createClient } from "@supabase/supabase-js";

// ── Supabase (Character project) ──────────────────────────────────────────────
const CHAR_SUPABASE_URL = process.env.SUPABASE_CHAR_URL!;
const CHAR_SUPABASE_KEY = process.env.SUPABASE_CHAR_SERVICE_KEY!;

export function getCharDb() {
  return createClient(CHAR_SUPABASE_URL, CHAR_SUPABASE_KEY);
}

// ── Modal endpoints ───────────────────────────────────────────────────────────
const MODAL_BASE = process.env.MODAL_CHAR_AGENT_BASE_URL ?? "";

export const modalEndpoints = {
  health:       () => `${MODAL_BASE}/health`,
  chat:         () => `${MODAL_BASE}/chat`,
  conversation: () => `${MODAL_BASE}/conversation`,
  reflect:      () => `${MODAL_BASE}/reflect`,
  evaluate:     () => `${MODAL_BASE}/evaluate`,
  budget:       () => `${MODAL_BASE}/budget`,
};

// ── Character CRUD helpers ────────────────────────────────────────────────────

export interface CharacterRow {
  id: string;
  name: string;
  gender: "male" | "female";
  ethnicity: string;
  age: string;
  outfit: string | null;
  anchor_extra: string | null;
  base_prompt: string | null;
  personality: Record<string, unknown>;
  knowledge_notes: string[];
  raw_profile: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function registerCharacter(profileJson: Record<string, unknown>): Promise<CharacterRow> {
  const sb = getCharDb();

  const payload = {
    name:          profileJson.name as string,
    gender:        profileJson.gender as string,
    ethnicity:     profileJson.ethnicity as string,
    age:           profileJson.age as string,
    outfit:        (profileJson.outfit as string) ?? null,
    anchor_extra:  (profileJson.anchor_extra as string) ?? null,
    base_prompt:   (profileJson.base_prompt as string) ?? null,
    personality:   (profileJson.personality as Record<string, unknown>) ?? {},
    knowledge_notes: [],
    raw_profile:   profileJson,
  };

  const { data, error } = await sb
    .from("characters")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(`registerCharacter failed: ${error.message}`);
  return data as CharacterRow;
}

export async function getCharacter(id: string): Promise<CharacterRow | null> {
  const sb = getCharDb();
  const { data } = await sb.from("characters").select("*").eq("id", id).single();
  return data ?? null;
}

export async function listCharacters(): Promise<CharacterRow[]> {
  const sb = getCharDb();
  const { data, error } = await sb
    .from("characters")
    .select("id, name, gender, ethnicity, age, personality, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as CharacterRow[];
}

// ── Conversation helpers ──────────────────────────────────────────────────────

export async function getConversationMessages(conversationId: string) {
  const sb = getCharDb();
  const { data, error } = await sb
    .from("messages")
    .select("id, role, content, character_id, round_number, sequence_number, created_at")
    .eq("conversation_id", conversationId)
    .order("sequence_number");

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSkillEvolutionLog(characterId: string, limit = 10) {
  const sb = getCharDb();
  const { data, error } = await sb
    .from("skill_evolution_log")
    .select("*")
    .eq("character_id", characterId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Modal proxy helper ────────────────────────────────────────────────────────

export async function callModal<T>(
  endpoint: string,
  body: Record<string, unknown>,
  apiKey: string,
): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Modal ${endpoint} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}
