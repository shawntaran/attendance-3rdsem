import { describe, expect, it } from "vitest";
import { PORTAL_BASELINE, odStateAll } from "./config";
import {
  STORAGE_KEY,
  STORAGE_KEY_V1,
  STORAGE_KEY_V2,
  defaultState,
  loadFrom,
  migrateV1,
  migrateV2,
  parseState,
  type KeyValueStore,
} from "./storage";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

/** A state as the v1 app saved it. */
function v1State(scenario: "odsGranted" | "odsPending", extra: Record<string, unknown> = {}) {
  const table = Object.fromEntries(Object.keys(PORTAL_BASELINE).map((c) => [c, [1, 2]]));
  return {
    settings: {
      theme: "dark",
      scenario,
      targetPct: 80,
      cushionHours: 2,
      baselineAsOf: "2026-11-12",
      baselines: { odsGranted: table, odsPending: table },
      holidays: ["2026-11-20"],
      ...extra,
    },
    marks: { "2026-11-12@1": "skipped", "2026-11-13@3": "attended" },
  };
}

/** A state as the v2 app saved it: no windowEnd, no extraWorkingDays. */
function v2State() {
  const { windowEnd: _w, extraWorkingDays: _x, ...settings } = defaultState().settings;
  settings.theme = "dark";
  settings.cushionHours = 2;
  settings.holidays = ["2026-11-20"];
  settings.baseline = { ...settings.baseline, MAT2303: [27, 39] };
  settings.odState = { ...settings.odState, "od-2026-10-30": { on: false, inPortal: true } };
  return { settings, marks: { "2026-11-12@1": "skipped" } };
}

describe("parseState (v3)", () => {
  it("round-trips a valid state", () => {
    const state = defaultState();
    state.settings.theme = "dark";
    state.settings.holidays = ["2026-11-20"];
    state.settings.odState["od-2026-10-30"] = { on: false, inPortal: true };
    state.settings.baseline.MAT2303 = [27, 38];
    state.marks["2026-11-12@1"] = "skipped";
    state.settings.windowEnd = "2026-12-11";
    state.settings.extraWorkingDays.push({ date: "2026-12-12", followsWeekday: 3, reason: "Extra" });
    expect(parseState(JSON.stringify(state))).toEqual(state);
  });

  const d = defaultState();
  it.each([
    ["nothing stored", null],
    ["broken JSON", "{not json"],
    ["wrong shape", JSON.stringify({ settings: 1, marks: [] })],
    ["unknown theme", JSON.stringify({ ...d, settings: { ...d.settings, theme: "neon" } })],
    ["bad mark value", JSON.stringify({ ...d, marks: { "2026-11-12@1": "maybe" } })],
    ["bad mark id", JSON.stringify({ ...d, marks: { "12 Nov": "skipped" } })],
    ["bad date", JSON.stringify({ ...d, settings: { ...d.settings, baselineAsOf: "2026-13-40" } })],
    ["missing course in baseline", JSON.stringify({ ...d, settings: { ...d.settings, baseline: {} } })],
    ["missing OD", JSON.stringify({ ...d, settings: { ...d.settings, odState: {} } })],
    [
      "bad OD toggle",
      JSON.stringify({
        ...d,
        settings: { ...d.settings, odState: { ...d.settings.odState, "od-2026-08-12": { on: "yes", inPortal: false } } },
      }),
    ],
    ["a v1 state under the v3 key", JSON.stringify(v1State("odsGranted"))],
    ["a v2 state under the v3 key", JSON.stringify(v2State())],
    ["windowEnd before the start", JSON.stringify({ ...d, settings: { ...d.settings, windowEnd: "2026-11-01" } })],
    [
      "extra working day on a Sunday",
      JSON.stringify({
        ...d,
        settings: { ...d.settings, extraWorkingDays: [{ date: "2026-12-06", followsWeekday: 1, reason: "" }] },
      }),
    ],
    [
      "extra working day with a bad weekday",
      JSON.stringify({
        ...d,
        settings: { ...d.settings, extraWorkingDays: [{ date: "2026-12-05", followsWeekday: 6, reason: "" }] },
      }),
    ],
    [
      "repeated extra working day",
      JSON.stringify({
        ...d,
        settings: {
          ...d.settings,
          extraWorkingDays: [...d.settings.extraWorkingDays, ...d.settings.extraWorkingDays],
        },
      }),
    ],
  ])("falls back to defaults on %s", (_name, raw) => {
    expect(parseState(raw)).toEqual(defaultState());
  });
});

describe("v1 to v2 migration", () => {
  it.each([
    ["odsGranted", true],
    ["odsPending", false],
  ] as const)("%s becomes all ODs %s", (scenario, on) => {
    const migrated = migrateV1(JSON.stringify(v1State(scenario)));
    expect(migrated).not.toBeNull();
    const { settings, marks } = migrated!;
    // Kept.
    expect(marks).toEqual({ "2026-11-12@1": "skipped", "2026-11-13@3": "attended" });
    expect(settings.targetPct).toBe(80);
    expect(settings.cushionHours).toBe(2);
    expect(settings.holidays).toEqual(["2026-11-20"]);
    expect(settings.theme).toBe("dark");
    // Scenario turned into OD switches.
    expect(settings.odState).toEqual(odStateAll(on));
    // Baseline reset to the new portal defaults.
    expect(settings.baseline).toEqual(PORTAL_BASELINE);
    expect(settings.baselineAsOf).toBe("2026-11-10");
    // The result is a valid v2 state.
    expect(parseState(JSON.stringify(migrated))).toEqual(migrated);
  });

  it("accepts a v1 state from before the theme setting", () => {
    const old = v1State("odsPending");
    delete (old.settings as Record<string, unknown>).theme;
    expect(migrateV1(JSON.stringify(old))?.settings.theme).toBe("system");
  });

  it.each([
    ["nothing", null],
    ["broken JSON", "{oops"],
    ["unknown scenario", JSON.stringify(v1State("odsGranted", { scenario: "maybe" }))],
    ["bad marks", JSON.stringify({ ...v1State("odsGranted"), marks: { x: "skipped" } })],
  ])("returns null for %s", (_name, raw) => {
    expect(migrateV1(raw)).toBeNull();
  });

  it("loadFrom migrates once, writes v3 and removes v1", () => {
    const store = memoryStore({ [STORAGE_KEY_V1]: JSON.stringify(v1State("odsPending")) });
    const state = loadFrom(store);
    expect(state.settings.odState).toEqual(odStateAll(false));
    expect(store.data[STORAGE_KEY_V1]).toBeUndefined();
    expect(JSON.parse(store.data[STORAGE_KEY])).toEqual(state);
    expect(loadFrom(store)).toEqual(state);
  });

  it("loadFrom prefers v2 and leaves v1 alone when both exist", () => {
    const v2 = defaultState();
    v2.settings.cushionHours = 3;
    const store = memoryStore({
      [STORAGE_KEY]: JSON.stringify(v2),
      [STORAGE_KEY_V1]: JSON.stringify(v1State("odsPending")),
    });
    expect(loadFrom(store)).toEqual(v2);
    expect(store.data[STORAGE_KEY_V1]).toBeDefined();
  });

  it("loadFrom keeps an unreadable v1 value and returns defaults", () => {
    const store = memoryStore({ [STORAGE_KEY_V1]: "{oops" });
    expect(loadFrom(store)).toEqual(defaultState());
    expect(store.data[STORAGE_KEY_V1]).toBe("{oops");
    expect(store.data[STORAGE_KEY]).toBeUndefined();
  });
});

describe("v2 to v3 migration", () => {
  it("keeps everything and adds the new window defaults", () => {
    const old = v2State();
    const migrated = migrateV2(JSON.stringify(old));
    expect(migrated).toEqual({
      settings: {
        ...old.settings,
        windowEnd: "2026-12-05",
        extraWorkingDays: [{ date: "2026-12-05", followsWeekday: 1, reason: "Make-up for Mon 9 Nov holiday" }],
      },
      marks: old.marks,
    });
    expect(parseState(JSON.stringify(migrated))).toEqual(migrated);
  });

  it("returns null for an unreadable v2 value", () => {
    expect(migrateV2("{oops")).toBeNull();
    expect(migrateV2(JSON.stringify({ settings: { theme: "neon" }, marks: {} }))).toBeNull();
  });

  it("loadFrom migrates v2, writes v3 and removes v2", () => {
    const store = memoryStore({ [STORAGE_KEY_V2]: JSON.stringify(v2State()) });
    const state = loadFrom(store);
    expect(state.settings.windowEnd).toBe("2026-12-05");
    expect(state.settings.cushionHours).toBe(2);
    expect(store.data[STORAGE_KEY_V2]).toBeUndefined();
    expect(JSON.parse(store.data[STORAGE_KEY])).toEqual(state);
    expect(loadFrom(store)).toEqual(state);
  });

  it("loadFrom prefers v2 over v1 and leaves v1 alone", () => {
    const store = memoryStore({
      [STORAGE_KEY_V2]: JSON.stringify(v2State()),
      [STORAGE_KEY_V1]: JSON.stringify(v1State("odsPending")),
    });
    expect(loadFrom(store).settings.cushionHours).toBe(2);
    expect(store.data[STORAGE_KEY_V1]).toBeDefined();
  });

  it("a v1 state migrates straight to v3", () => {
    const store = memoryStore({ [STORAGE_KEY_V1]: JSON.stringify(v1State("odsGranted")) });
    const state = loadFrom(store);
    expect(state.settings.windowEnd).toBe("2026-12-05");
    expect(state.settings.extraWorkingDays).toHaveLength(1);
    expect(store.data[STORAGE_KEY_V1]).toBeUndefined();
  });
});
