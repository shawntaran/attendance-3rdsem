// This device's copy of the cloud access key (see src/lib/server/access.ts).
// Entered once per device and kept in localStorage; it is only ever sent to
// this app's own /api/planner.

const KEY = "skip-planner:access-key";

export function getAccessKey(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAccessKey(value: string): void {
  window.localStorage.setItem(KEY, value.trim());
}

export function clearAccessKey(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
