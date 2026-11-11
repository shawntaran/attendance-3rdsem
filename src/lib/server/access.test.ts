import { describe, expect, it } from "vitest";
import { checkAccess, keyFromHeader, MIN_KEY_LENGTH } from "./access";

const KEY = "k".repeat(MIN_KEY_LENGTH) + "-secret";

describe("access key", () => {
  it("reads a Bearer header", () => {
    expect(keyFromHeader(`Bearer ${KEY}`)).toBe(KEY);
    expect(keyFromHeader(`bearer   ${KEY}  `)).toBe(KEY);
    expect(keyFromHeader(KEY)).toBeNull();
    expect(keyFromHeader(null)).toBeNull();
  });

  it("lets the right key in", () => {
    expect(checkAccess(KEY, KEY)).toBe("ok");
  });

  it.each([
    ["no key", null],
    ["wrong key", KEY + "x"],
    ["prefix of the key", KEY.slice(0, -1)],
    ["empty key", ""],
  ])("refuses %s", (_name, presented) => {
    expect(checkAccess(presented, KEY)).toBe("unauthorized");
  });

  it("fails closed when the server has no key or a short one", () => {
    expect(checkAccess(KEY, undefined)).toBe("missing_server_key");
    expect(checkAccess(KEY, "")).toBe("missing_server_key");
    expect(checkAccess("short", "short")).toBe("weak_server_key");
  });
});
