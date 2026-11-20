import "server-only";

import { memoryUserRepo, type UserRepo } from "./auth";
import { memoryRepo, type PlannerRepo } from "./plannerApi";
import { appwriteConfigured, appwritePlannerRepo, appwriteUserRepo } from "./appwriteRepo";
import { supabaseConfigured, supabasePlannerRepo, supabaseUserRepo } from "./supabaseRepo";

// The same app runs on either database, picked by environment variables:
//   DATABASE=supabase or DATABASE=appwrite forces one;
//   otherwise Supabase if SUPABASE_URL is set, else Appwrite.
// Each deployment keeps its own data; the two are not synced with each other.
//   DATABASE=memory (development only) keeps everything in this process's memory,
//   for trying sign-in locally; it is lost on restart and refused in production.

export type Backend = "supabase" | "appwrite" | "memory";

// Kept on globalThis so dev hot reloads do not wipe it.
const memory = ((globalThis as { __plannerMemory?: { users: UserRepo; planners: Map<string, PlannerRepo> } }).__plannerMemory ??= {
  users: memoryUserRepo(),
  planners: new Map(),
});

export function backend(): Backend | null {
  const forced = process.env.DATABASE?.toLowerCase();
  if (forced === "memory") return process.env.NODE_ENV === "production" ? null : "memory";
  if (forced === "supabase") return supabaseConfigured() ? "supabase" : null;
  if (forced === "appwrite") return appwriteConfigured() ? "appwrite" : null;
  if (supabaseConfigured()) return "supabase";
  if (appwriteConfigured()) return "appwrite";
  return null;
}

export function userRepo(): UserRepo | null {
  const b = backend();
  if (b === "memory") return memory.users;
  return b === "supabase" ? supabaseUserRepo() : b === "appwrite" ? appwriteUserRepo() : null;
}

export function plannerRepo(user: string): PlannerRepo | null {
  const b = backend();
  if (b === "memory") {
    if (!memory.planners.has(user)) memory.planners.set(user, memoryRepo());
    return memory.planners.get(user)!;
  }
  return b === "supabase" ? supabasePlannerRepo(user) : b === "appwrite" ? appwritePlannerRepo(user) : null;
}
