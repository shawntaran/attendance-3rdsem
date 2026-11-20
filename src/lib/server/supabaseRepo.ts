import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { UserRecord, UserRepo } from "./auth";
import type { PlannerRepo } from "./plannerApi";
import { versionedRepo, type VersionRow, type VersionStore } from "./versionedRepo";

// Supabase backend: the same append-only versions as the Appwrite one. The
// primary key (user_key, version) refuses a second row for the same version
// (Postgres error 23505), which is the compare-and-swap the API relies on.
// Tables: supabase/migrations/0002_multi_user.sql.

const USERS = "users";
const VERSIONS = "planner_versions";
const UNIQUE_VIOLATION = "23505";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}

export function supabaseConfigured(): boolean {
  return getClient() !== null;
}

interface VersionRowData {
  version: number | string;
  state: string;
  created_at: string;
}

const toVersionRow = (r: VersionRowData): VersionRow => ({ version: Number(r.version), state: r.state, createdAt: r.created_at });

export function supabasePlannerRepo(user: string): PlannerRepo | null {
  const db = getClient();
  if (!db) return null;
  const store: VersionStore = {
    async latest() {
      const { data, error } = await db
        .from(VERSIONS)
        .select("version, state, created_at")
        .eq("user_key", user)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle<VersionRowData>();
      if (error) throw error;
      return data ? toVersionRow(data) : null;
    },
    async create(version, state) {
      const { data, error } = await db
        .from(VERSIONS)
        .insert({ user_key: user, version, state })
        .select("version, state, created_at")
        .single<VersionRowData>();
      if (error?.code === UNIQUE_VIOLATION) return "exists";
      if (error) throw error;
      return toVersionRow(data);
    },
    async remove(version) {
      const { error } = await db.from(VERSIONS).delete().eq("user_key", user).eq("version", version);
      if (error) throw error;
    },
    async pruneBelow(version) {
      const { error } = await db.from(VERSIONS).delete().eq("user_key", user).lt("version", version);
      if (error) throw error;
    },
  };
  return versionedRepo(store);
}

interface UserRowData {
  key: string;
  name: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: string | null;
}

const toUser = (r: UserRowData): UserRecord => ({
  key: r.key,
  name: r.name,
  pinHash: r.pin_hash,
  failedAttempts: Number(r.failed_attempts ?? 0),
  lockedUntil: r.locked_until ?? null,
});

export function supabaseUserRepo(): UserRepo | null {
  const db = getClient();
  if (!db) return null;
  return {
    async get(key) {
      const { data, error } = await db.from(USERS).select("*").eq("key", key).maybeSingle<UserRowData>();
      if (error) throw error;
      return data ? toUser(data) : null;
    },
    async create(user) {
      const { data, error } = await db
        .from(USERS)
        .insert({ key: user.key, name: user.name, pin_hash: user.pinHash, failed_attempts: 0, locked_until: null })
        .select("*")
        .single<UserRowData>();
      if (error?.code === UNIQUE_VIOLATION) return "exists";
      if (error) throw error;
      return toUser(data);
    },
    async update(key, patch) {
      const row: Partial<UserRowData> = {};
      if (patch.failedAttempts !== undefined) row.failed_attempts = patch.failedAttempts;
      if (patch.lockedUntil !== undefined) row.locked_until = patch.lockedUntil;
      const { error } = await db.from(USERS).update(row).eq("key", key);
      if (error) throw error;
    },
  };
}
