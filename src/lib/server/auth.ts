// Accounts are just a name and a PIN. No email, no password reset: a forgotten
// PIN is cleared by deleting that user's row in the database console.
//
// - The name is shown as typed; it is looked up by a normalized key
//   (lowercase, letters and digits joined by "-"), so "Shawn T" and "shawn-t"
//   are the same account.
// - The PIN (4 to 6 digits) is stored only as a salted scrypt hash.
// - Five wrong PINs in a row lock the account for 15 minutes.
// - A signed-in browser holds a session cookie: the user key and an expiry,
//   signed with SESSION_SECRET (HMAC-SHA256). Nothing is stored per session.
//
// Pure functions over a small repository interface, so all of it is testable.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const SESSION_DAYS = 180;
export const SESSION_COOKIE = "sp_session";
export const MIN_SECRET_LENGTH = 32;

export interface UserRecord {
  key: string;
  name: string;
  pinHash: string;
  failedAttempts: number;
  /** ISO time until which sign-in is refused, or null. */
  lockedUntil: string | null;
}

export interface UserRepo {
  get(key: string): Promise<UserRecord | null>;
  /** "exists" if the key is taken. */
  create(user: UserRecord): Promise<UserRecord | "exists">;
  update(key: string, patch: Partial<Pick<UserRecord, "failedAttempts" | "lockedUntil">>): Promise<void>;
}

// ---- names and PINs ----------------------------------------------------------

/** "Shawn Taran" -> "shawn-taran". Null if it leaves fewer than 2 characters. */
export function userKey(name: string): string | null {
  const key = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return key.length >= 2 ? key : null;
}

/** The name as shown: trimmed, inner spaces collapsed, at most 40 characters. */
export function displayName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 40);
}

export function validPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,6}$/.test(pin);
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, n, saltText, hashText] = stored.split("$");
  if (scheme !== "scrypt" || !n || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = scryptSync(pin, Buffer.from(saltText, "base64url"), expected.length, {
    N: Number(n),
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---- sessions ----------------------------------------------------------------

export interface Session {
  key: string;
  name: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSession(user: Pick<UserRecord, "key" | "name">, secret: string, now: number): string {
  const payload = Buffer.from(
    JSON.stringify({ key: user.key, name: user.name, exp: now + SESSION_DAYS * 86_400_000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** The session in a cookie value, or null if missing, forged or expired. */
export function readSession(token: string | undefined | null, secret: string, now: number): Session | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (typeof s.key !== "string" || typeof s.name !== "string" || typeof s.exp !== "number") return null;
    return s.exp > now ? s : null;
  } catch {
    return null;
  }
}

// ---- sign-up and sign-in -----------------------------------------------------

export interface AuthResult {
  status: number;
  body: { error?: string; message?: string; name?: string; key?: string };
  /** Set on success: the user to start a session for. */
  user?: Pick<UserRecord, "key" | "name">;
}

function bad(status: number, error: string, message: string): AuthResult {
  return { status, body: { error, message } };
}

function readCredentials(body: unknown): { name: string; key: string; pin: string } | AuthResult {
  if (typeof body !== "object" || body === null) return bad(400, "invalid_body", "Send a name and a PIN.");
  const { name, pin } = body as Record<string, unknown>;
  if (typeof name !== "string") return bad(400, "invalid_name", "Enter your name.");
  const key = userKey(name);
  if (!key) return bad(400, "invalid_name", "Use at least two letters or digits in your name.");
  if (!validPin(pin)) return bad(400, "invalid_pin", "The PIN must be 4 to 6 digits.");
  return { name: displayName(name), key, pin };
}

export async function signUp(repo: UserRepo, body: unknown): Promise<AuthResult> {
  const c = readCredentials(body);
  if ("status" in c) return c;
  const created = await repo.create({ key: c.key, name: c.name, pinHash: hashPin(c.pin), failedAttempts: 0, lockedUntil: null });
  if (created === "exists") {
    return bad(409, "name_taken", "That name is taken. Sign in, or add an initial to make yours different.");
  }
  return { status: 200, body: { name: created.name, key: created.key }, user: created };
}

export async function signIn(repo: UserRepo, body: unknown, now: number): Promise<AuthResult> {
  const c = readCredentials(body);
  if ("status" in c) return c;
  const user = await repo.get(c.key);
  // Same answer for an unknown name and a wrong PIN, so names cannot be probed by PIN.
  const wrong = bad(401, "wrong_credentials", "That name and PIN do not match.");
  if (!user) return wrong;
  if (user.lockedUntil && Date.parse(user.lockedUntil) > now) {
    const minutes = Math.ceil((Date.parse(user.lockedUntil) - now) / 60_000);
    return bad(429, "locked", `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  if (!verifyPin(c.pin, user.pinHash)) {
    const failed = user.failedAttempts + 1;
    const lock = failed >= MAX_FAILED_ATTEMPTS;
    await repo.update(user.key, {
      failedAttempts: lock ? 0 : failed,
      lockedUntil: lock ? new Date(now + LOCK_MINUTES * 60_000).toISOString() : null,
    });
    return lock ? bad(429, "locked", `Too many wrong PINs. Try again in ${LOCK_MINUTES} minutes.`) : wrong;
  }
  if (user.failedAttempts > 0 || user.lockedUntil) await repo.update(user.key, { failedAttempts: 0, lockedUntil: null });
  return { status: 200, body: { name: user.name, key: user.key }, user };
}

/** In-memory users, same rules, for tests. */
export function memoryUserRepo() {
  const users = new Map<string, UserRecord>();
  return {
    users,
    async get(key: string) {
      const u = users.get(key);
      return u ? { ...u } : null;
    },
    async create(user: UserRecord) {
      if (users.has(user.key)) return "exists" as const;
      users.set(user.key, { ...user });
      return { ...user };
    },
    async update(key: string, patch: Partial<UserRecord>) {
      const u = users.get(key);
      if (u) users.set(key, { ...u, ...patch });
    },
  };
}
