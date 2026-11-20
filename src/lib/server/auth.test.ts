import { describe, expect, it } from "vitest";
import {
  createSession,
  hashPin,
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
  memoryUserRepo,
  readSession,
  signIn,
  signUp,
  userKey,
  verifyPin,
} from "./auth";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-20T10:00:00Z");

describe("names and PINs", () => {
  it("normalizes names to one key per person", () => {
    expect(userKey("Shawn Taran")).toBe("shawn-taran");
    expect(userKey("  shawn   TARAN ")).toBe("shawn-taran");
    expect(userKey("Shawn_Taran!")).toBe("shawn-taran");
    expect(userKey("Rahul K.")).toBe("rahul-k");
    expect(userKey("a")).toBeNull();
    expect(userKey("!!")).toBeNull();
    expect(userKey("x".repeat(60))!.length).toBeLessThanOrEqual(24);
  });

  it("hashes PINs with a salt and verifies them", () => {
    const a = hashPin("1234");
    const b = hashPin("1234");
    expect(a).not.toBe(b);
    expect(a).not.toContain("1234");
    expect(verifyPin("1234", a)).toBe(true);
    expect(verifyPin("1235", a)).toBe(false);
    expect(verifyPin("1234", "garbage")).toBe(false);
  });
});

describe("sessions", () => {
  it("round-trips, and rejects forged or expired tokens", () => {
    const t = createSession({ key: "shawn", name: "Shawn" }, SECRET, NOW);
    expect(readSession(t, SECRET, NOW)).toMatchObject({ key: "shawn", name: "Shawn" });
    expect(readSession(t, "x".repeat(40), NOW)).toBeNull();
    const [payload] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ key: "rahul", name: "Rahul", exp: NOW + 1e9 })).toString("base64url");
    expect(readSession(`${forged}.${t.split(".")[1]}`, SECRET, NOW)).toBeNull();
    expect(readSession(`${payload}.bad`, SECRET, NOW)).toBeNull();
    expect(readSession(t, SECRET, NOW + 181 * 86_400_000)).toBeNull();
    expect(readSession(undefined, SECRET, NOW)).toBeNull();
  });
});

describe("sign-up and sign-in", () => {
  it("signs up once per name, case-insensitively", async () => {
    const repo = memoryUserRepo();
    expect((await signUp(repo, { name: "Shawn Taran", pin: "1234" })).status).toBe(200);
    expect((await signUp(repo, { name: "shawn taran", pin: "9999" })).status).toBe(409);
    expect(repo.users.get("shawn-taran")?.name).toBe("Shawn Taran");
  });

  it.each([
    [{ name: "Shawn", pin: "12" }, "invalid_pin"],
    [{ name: "Shawn", pin: "1234567" }, "invalid_pin"],
    [{ name: "Shawn", pin: "12ab" }, "invalid_pin"],
    [{ name: "!", pin: "1234" }, "invalid_name"],
    [null, "invalid_body"],
  ])("rejects %j", async (body, error) => {
    const res = await signUp(memoryUserRepo(), body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(error);
  });

  it("signs in with the right PIN; unknown name and wrong PIN look the same", async () => {
    const repo = memoryUserRepo();
    await signUp(repo, { name: "Shawn", pin: "1234" });
    expect(await signIn(repo, { name: "SHAWN", pin: "1234" }, NOW)).toMatchObject({ status: 200, user: { key: "shawn" } });
    const wrong = await signIn(repo, { name: "Shawn", pin: "0000" }, NOW);
    const unknown = await signIn(repo, { name: "Nobody", pin: "0000" }, NOW);
    expect(wrong.status).toBe(401);
    expect(unknown).toEqual(wrong);
  });

  it("locks after five wrong PINs, then lets the right PIN in once the lock passes", async () => {
    const repo = memoryUserRepo();
    await signUp(repo, { name: "Shawn", pin: "1234" });
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      expect((await signIn(repo, { name: "Shawn", pin: "0000" }, NOW)).status).toBe(401);
    }
    expect((await signIn(repo, { name: "Shawn", pin: "0000" }, NOW)).status).toBe(429);
    // Even the right PIN is refused while locked.
    expect((await signIn(repo, { name: "Shawn", pin: "1234" }, NOW + 60_000)).status).toBe(429);
    const later = NOW + (LOCK_MINUTES + 1) * 60_000;
    expect((await signIn(repo, { name: "Shawn", pin: "1234" }, later)).status).toBe(200);
    expect(repo.users.get("shawn")).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });
});
