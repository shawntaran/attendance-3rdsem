import { describe, expect, it } from "vitest";
import { defaultState, parseState } from "./storage";

describe("parseState", () => {
  it("round-trips a valid state", () => {
    const state = defaultState();
    state.settings.scenario = "odsPending";
    state.settings.holidays = ["2026-11-20"];
    state.marks["2026-11-12@1"] = "skipped";
    expect(parseState(JSON.stringify(state))).toEqual(state);
  });

  it("accepts a state saved before the theme setting existed", () => {
    const state = defaultState();
    state.marks["2026-11-12@1"] = "attended";
    const { theme: _theme, ...oldSettings } = state.settings;
    expect(parseState(JSON.stringify({ settings: oldSettings, marks: state.marks }))).toEqual(state);
  });

  it.each([
    ["nothing stored", null],
    ["unknown theme", JSON.stringify({ ...defaultState(), settings: { ...defaultState().settings, theme: "neon" } })],
    ["broken JSON", "{not json"],
    ["wrong shape", JSON.stringify({ settings: 1, marks: [] })],
    ["bad mark value", JSON.stringify({ ...defaultState(), marks: { "2026-11-12@1": "maybe" } })],
    ["bad mark id", JSON.stringify({ ...defaultState(), marks: { "12 Nov": "skipped" } })],
    [
      "bad date",
      JSON.stringify({ ...defaultState(), settings: { ...defaultState().settings, baselineAsOf: "2026-13-40" } }),
    ],
    [
      "missing course in baseline",
      JSON.stringify({
        ...defaultState(),
        settings: { ...defaultState().settings, baselines: { odsGranted: {}, odsPending: {} } },
      }),
    ],
  ])("falls back to defaults on %s", (_name, raw) => {
    expect(parseState(raw)).toEqual(defaultState());
  });
});
