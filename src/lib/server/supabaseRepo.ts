import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppState } from "../storage";
import type { PlannerRepo, StoredRecord } from "./plannerApi";

/** The one row this single-user app keeps. Matches the CHECK constraint in the SQL migration. */
export const PLANNER_ID = "00000000-0000-0000-0000-000000000001";
const TABLE = "planner_state";

interface Row {
  state: unknown;
  version: number | string;
  updated_at: string;
}

function toRecord(row: Row): StoredRecord {
  return { state: row.state, version: Number(row.version), updatedAt: row.updated_at };
}

let client: SupabaseClient | null = null;

/**
 * The service-role client, created on the server only. Returns null when the
 * environment variables are not set, so the API can answer "not configured"
 * instead of crashing (local dev without Supabase, or a fresh deploy).
 */
function getClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

export function supabaseRepo(): PlannerRepo | null {
  const db = getClient();
  if (!db) return null;
  return {
    async get() {
      const { data, error } = await db
        .from(TABLE)
        .select("state, version, updated_at")
        .eq("id", PLANNER_ID)
        .maybeSingle<Row>();
      if (error) throw error;
      return data ? toRecord(data) : null;
    },

    async insert(state: AppState) {
      const { data, error } = await db
        .from(TABLE)
        .insert({ id: PLANNER_ID, state, version: 1 })
        .select("state, version, updated_at")
        .single<Row>();
      // 23505 = unique_violation: another device created the record first.
      if (error?.code === "23505") return "exists";
      if (error) throw error;
      return toRecord(data);
    },

    async update(state: AppState, expectedVersion: number) {
      // One UPDATE ... WHERE version = expected: atomic, so two devices
      // cannot both succeed from the same version.
      const { data, error } = await db
        .from(TABLE)
        .update({ state, version: expectedVersion + 1 })
        .eq("id", PLANNER_ID)
        .eq("version", expectedVersion)
        .select("state, version, updated_at")
        .maybeSingle<Row>();
      if (error) throw error;
      return data ? toRecord(data) : "stale";
    },
  };
}
