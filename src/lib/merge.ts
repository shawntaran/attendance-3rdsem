// Three-way merge of two AppStates that both started from the same base.
//
// The state is flattened into independent entries ("paths"): one per
// attendance mark (by session id), one per scalar setting, one per course in
// the baseline, one per OD, one per holiday date and one per extra working
// day. Each path is merged on its own:
//
//   local == remote   -> that value
//   local == base     -> remote changed it, take remote
//   remote == base    -> local changed it, take local
//   otherwise         -> a real conflict: both changed it differently
//
// So two devices marking different classes, or one toggling an OD while the
// other edits a holiday, merge cleanly. Only the same mark or setting changed
// differently on both sides is a conflict; the caller decides which side wins
// and keeps the other one for recovery.

import { COURSE_CODES, type Settings } from "./config";
import type { Mark } from "./plan";
import { validateState, type AppState } from "./storage";

/** path -> JSON of the value. A missing path means "not set" (e.g. no mark). */
export type Flat = Map<string, string>;

const SCALARS = ["theme", "targetPct", "cushionHours", "baselineAsOf", "windowEnd"] as const;

export function flatten(state: AppState): Flat {
  const out: Flat = new Map();
  const s = state.settings;
  for (const key of SCALARS) out.set(`settings.${key}`, JSON.stringify(s[key]));
  if (s.baselineRevision !== undefined) out.set("settings.baselineRevision", JSON.stringify(s.baselineRevision));
  for (const code of COURSE_CODES) out.set(`baseline/${code}`, JSON.stringify(s.baseline[code]));
  for (const [id, t] of Object.entries(s.odState)) out.set(`od/${id}`, JSON.stringify({ on: t.on, inPortal: t.inPortal }));
  for (const date of s.holidays) out.set(`holiday/${date}`, "true");
  for (const x of s.extraWorkingDays) {
    out.set(`extra/${x.date}`, JSON.stringify({ followsWeekday: x.followsWeekday, reason: x.reason }));
  }
  for (const [id, mark] of Object.entries(state.marks)) out.set(`mark/${id}`, JSON.stringify(mark));
  return out;
}

/** Rebuild a state from flat entries and validate it. Throws if it is not valid. */
export function unflatten(flat: Flat): AppState {
  const settings: Record<string, unknown> = {
    baseline: {},
    odState: {},
    holidays: [] as string[],
    extraWorkingDays: [] as unknown[],
  };
  const marks: Record<string, Mark> = {};
  for (const [path, json] of flat) {
    const value: unknown = JSON.parse(json);
    const slash = path.indexOf("/");
    const kind = slash === -1 ? path : path.slice(0, slash);
    const key = slash === -1 ? "" : path.slice(slash + 1);
    if (kind.startsWith("settings.")) settings[kind.slice("settings.".length)] = value;
    else if (kind === "baseline") (settings.baseline as Record<string, unknown>)[key] = value;
    else if (kind === "od") (settings.odState as Record<string, unknown>)[key] = value;
    else if (kind === "holiday") (settings.holidays as string[]).push(key);
    else if (kind === "extra") (settings.extraWorkingDays as unknown[]).push({ date: key, ...(value as object) });
    else if (kind === "mark") marks[key] = value as Mark;
    else throw new Error(`unknown path ${path}`);
  }
  return validateState({ settings: settings as unknown as Settings, marks });
}

export function statesEqual(a: AppState, b: AppState): boolean {
  const fa = flatten(a);
  const fb = flatten(b);
  if (fa.size !== fb.size) return false;
  for (const [k, v] of fa) if (fb.get(k) !== v) return false;
  return true;
}

export interface MergeConflict {
  path: string;
  /** JSON of each side's value; undefined means "not set". */
  base?: string;
  local?: string;
  remote?: string;
}

export interface MergeResult {
  /** Merged state, with the remote value on every conflicting path. */
  merged: AppState;
  conflicts: MergeConflict[];
}

/**
 * Merge local and remote changes made on top of base. Conflicting paths take
 * the remote value (the cloud is authoritative); the local values are
 * returned in `conflicts` so the caller can keep them for recovery.
 * Throws only if the merged result is not a valid state.
 */
export function mergeStates(base: AppState, local: AppState, remote: AppState): MergeResult {
  const b = flatten(base);
  const l = flatten(local);
  const r = flatten(remote);
  const out: Flat = new Map();
  const conflicts: MergeConflict[] = [];
  const paths = new Set([...b.keys(), ...l.keys(), ...r.keys()]);
  for (const path of [...paths].sort()) {
    const bv = b.get(path);
    const lv = l.get(path);
    const rv = r.get(path);
    let v: string | undefined;
    if (lv === rv) v = lv;
    else if (lv === bv) v = rv;
    else if (rv === bv) v = lv;
    else {
      v = rv;
      conflicts.push({ path, base: bv, local: lv, remote: rv });
    }
    if (v !== undefined) out.set(path, v);
  }
  return { merged: unflatten(out), conflicts };
}

/**
 * Put the local side back on the given conflicting paths, on top of the
 * current state. This is the "use this device's values" recovery action.
 */
export function applyLocalValues(current: AppState, conflicts: MergeConflict[]): AppState {
  const flat = flatten(current);
  for (const c of conflicts) {
    if (c.local === undefined) flat.delete(c.path);
    else flat.set(c.path, c.local);
  }
  return unflatten(flat);
}

/** A short human label for a conflicting path, e.g. "mark 2026-11-24@1". */
export function describePath(path: string): string {
  const [kind, key] = path.includes("/") ? [path.slice(0, path.indexOf("/")), path.slice(path.indexOf("/") + 1)] : [path, ""];
  switch (kind) {
    case "mark":
      return `attendance mark ${key}`;
    case "baseline":
      return `baseline ${key}`;
    case "od":
      return `OD ${key}`;
    case "holiday":
      return `holiday ${key}`;
    case "extra":
      return `extra working day ${key}`;
    default:
      return kind.replace("settings.", "setting ");
  }
}
