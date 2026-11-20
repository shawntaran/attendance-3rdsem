import "server-only";

import { cookies } from "next/headers";
import { MIN_SECRET_LENGTH, readSession, SESSION_COOKIE, SESSION_DAYS, type Session } from "./auth";

/** The signing secret, or null if it is missing or too short (then nobody can sign in). */
export function sessionSecret(): string | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= MIN_SECRET_LENGTH ? s : null;
}

/** The signed-in user for this request, or null. */
export async function currentSession(): Promise<Session | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const jar = await cookies();
  return readSession(jar.get(SESSION_COOKIE)?.value, secret, Date.now());
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
