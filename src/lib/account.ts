// Client side of the account endpoints. The session itself is an httpOnly
// cookie the browser sends on its own; this only knows who is signed in.

export interface Account {
  key: string;
  name: string;
}

export type WhoAmI =
  | { type: "signedIn"; account: Account }
  | { type: "signedOut" }
  /** The server has no database or session secret: the app can still run on this device. */
  | { type: "notConfigured"; message: string }
  /** No connection: open the last account from this device's cache. */
  | { type: "offline" };

export type AuthOutcome = { ok: true; account: Account } | { ok: false; message: string };

const LAST_ACCOUNT_KEY = "skip-planner:account";

/** Pseudo-account for using the planner on this device without signing in. */
export const LOCAL_ACCOUNT: Account = { key: "local", name: "This device" };

export function lastAccount(): Account | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(LAST_ACCOUNT_KEY) ?? "null") as Account | null;
    return v && typeof v.key === "string" && typeof v.name === "string" ? v : null;
  } catch {
    return null;
  }
}

export function rememberAccount(account: Account | null): void {
  try {
    if (account) window.localStorage.setItem(LAST_ACCOUNT_KEY, JSON.stringify(account));
    else window.localStorage.removeItem(LAST_ACCOUNT_KEY);
  } catch {
    // storage blocked: offline opening just will not work
  }
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(60_000), // a sleeping Render server takes ~50 s to wake
    headers: { "Content-Type": "application/json" },
  });
}

export async function whoAmI(): Promise<WhoAmI> {
  let res: Response;
  try {
    res = await call("/api/auth/me");
  } catch {
    return { type: "offline" };
  }
  const body = (await res.json().catch(() => ({}))) as { name?: string; key?: string; error?: string; message?: string };
  if (res.ok && body.key && body.name) return { type: "signedIn", account: { key: body.key, name: body.name } };
  if (res.status === 503 && body.error === "not_configured") {
    return { type: "notConfigured", message: body.message ?? "Accounts are not set up on this server." };
  }
  if (res.status === 401) return { type: "signedOut" };
  return { type: "offline" };
}

async function credentials(path: string, name: string, pin: string): Promise<AuthOutcome> {
  let res: Response;
  try {
    res = await call(path, { method: "POST", body: JSON.stringify({ name, pin }) });
  } catch {
    return { ok: false, message: "No connection to the server. Try again when you are online." };
  }
  const body = (await res.json().catch(() => ({}))) as { name?: string; key?: string; message?: string };
  if (res.ok && body.key && body.name) return { ok: true, account: { key: body.key, name: body.name } };
  return { ok: false, message: body.message ?? `Something went wrong (${res.status}).` };
}

export const signUp = (name: string, pin: string) => credentials("/api/auth/signup", name, pin);
export const signIn = (name: string, pin: string) => credentials("/api/auth/login", name, pin);

export async function signOut(): Promise<void> {
  try {
    await call("/api/auth/logout", { method: "POST" });
  } catch {
    // the cookie stays until it expires; the app forgets the account below anyway
  }
  rememberAccount(null);
}
