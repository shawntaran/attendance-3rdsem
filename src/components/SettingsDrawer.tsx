"use client";

import { useEffect, useRef, useState } from "react";
import {
  COURSES,
  SCENARIO_LABEL,
  WINDOW_END,
  WINDOW_START,
  type CourseCode,
  type Scenario,
  type Settings,
} from "@/lib/config";
import { formatDate, isValidDate } from "@/lib/dates";
import { CloseIcon } from "./icons";
import { useModal } from "./useModal";

interface Props {
  settings: Settings;
  markCount: number;
  onChange: (settings: Settings) => void;
  onResetMarks: () => void;
  onResetAll: () => void;
  onClose: () => void;
}

const inputCls =
  "min-h-11 w-full rounded-lg border-[1.5px] border-[#6b7885] bg-white px-2.5 py-2 text-sm tabular-nums text-ink";

/** Whole-number input that only commits valid values and snaps back on blur. */
function NumberField({
  value,
  min,
  max,
  onCommit,
  ...rest
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "min" | "max" | "onChange">) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      {...rest}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        const n = Number(v);
        if (v !== "" && Number.isInteger(n) && n >= min && n <= max) onCommit(n);
      }}
      onBlur={() => setText(String(value))}
      className={`${inputCls} ${rest.className ?? ""}`}
    />
  );
}

export function SettingsDrawer({ settings, markCount, onChange, onResetMarks, onResetAll, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [holidayDraft, setHolidayDraft] = useState("");
  useModal(ref, onClose);

  const baseline = settings.baselines[settings.scenario];

  function setBaseline(code: CourseCode, index: 0 | 1, n: number) {
    const pair: [number, number] = [...baseline[code]];
    pair[index] = n;
    onChange({
      ...settings,
      baselines: { ...settings.baselines, [settings.scenario]: { ...baseline, [code]: pair } },
    });
  }

  function addHoliday() {
    if (!isValidDate(holidayDraft) || settings.holidays.includes(holidayDraft)) return;
    onChange({ ...settings, holidays: [...settings.holidays, holidayDraft].sort() });
    setHolidayDraft("");
  }

  const holidayOk =
    isValidDate(holidayDraft) &&
    holidayDraft >= WINDOW_START &&
    holidayDraft <= WINDOW_END &&
    !settings.holidays.includes(holidayDraft);

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex justify-end bg-ink/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        className="anim-drawer flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <h2 id="settings-title" className="font-display text-xl font-bold">
            Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-empty"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <fieldset>
            <legend className="text-sm font-bold">Scenario</legend>
            <p className="mt-0.5 text-xs text-subtle">
              Whether your pending OD (on-duty) requests are counted as present.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {(Object.keys(SCENARIO_LABEL) as Scenario[]).map((s) => {
                const active = settings.scenario === s;
                return (
                  <label
                    key={s}
                    className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border-[1.5px] px-3 text-sm font-semibold has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink ${
                      active ? "border-teal bg-teal text-white" : "border-line bg-white hover:border-teal"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scenario"
                      className="sr-only"
                      checked={active}
                      onChange={() => onChange({ ...settings, scenario: s })}
                    />
                    {SCENARIO_LABEL[s]}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <label className="text-sm font-bold">
              Target %
              <NumberField
                value={settings.targetPct}
                min={1}
                max={100}
                onCommit={(n) => onChange({ ...settings, targetPct: n })}
                className="mt-1 font-normal"
              />
            </label>
            <label className="text-sm font-bold">
              Cushion (hours)
              <NumberField
                value={settings.cushionHours}
                min={0}
                max={20}
                onCommit={(n) => onChange({ ...settings, cushionHours: n })}
                className="mt-1 font-normal"
              />
            </label>
          </div>

          <h3 className="mt-6 text-sm font-bold">Baseline attendance ({SCENARIO_LABEL[settings.scenario]})</h3>
          <p className="mt-0.5 text-xs text-subtle">
            Present and held hours from your latest export. Classes on or before the date below are
            treated as already counted here.
          </p>
          <label className="mt-2 block text-sm font-semibold">
            Baseline as of
            <input
              type="date"
              value={settings.baselineAsOf}
              onChange={(e) => {
                if (isValidDate(e.target.value)) onChange({ ...settings, baselineAsOf: e.target.value });
              }}
              className={`${inputCls} mt-1 font-normal`}
            />
          </label>

          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-subtle">
                <th scope="col" className="py-1 pr-2 font-semibold">Course</th>
                <th scope="col" className="w-20 px-1 py-1 font-semibold">Present</th>
                <th scope="col" className="w-20 py-1 pl-1 font-semibold">Held</th>
              </tr>
            </thead>
            <tbody>
              {COURSES.map((c) => {
                const [present, held] = baseline[c.code];
                const bad = present > held;
                return (
                  <tr key={c.code} className="border-t border-line">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                      <span className="block leading-tight font-semibold">{c.name}</span>
                      <span className="text-xs text-subtle">{c.code}</span>
                      {bad && (
                        <span className="block text-xs font-semibold text-must-border">
                          Present is more than held
                        </span>
                      )}
                    </th>
                    <td className="px-1 py-1.5">
                      <NumberField
                        value={present}
                        min={0}
                        max={999}
                        aria-label={`${c.name} present hours`}
                        aria-invalid={bad}
                        onCommit={(n) => setBaseline(c.code, 0, n)}
                      />
                    </td>
                    <td className="py-1.5 pl-1">
                      <NumberField
                        value={held}
                        min={0}
                        max={999}
                        aria-label={`${c.name} held hours`}
                        aria-invalid={bad}
                        onCommit={(n) => setBaseline(c.code, 1, n)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <h3 className="mt-6 text-sm font-bold">Holidays</h3>
          <p className="mt-0.5 text-xs text-subtle">Classes on these dates are removed from the plan.</p>
          {settings.holidays.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {settings.holidays.map((h) => (
                <li key={h} className="flex items-center justify-between rounded-lg bg-empty pl-3 text-sm">
                  <span>{formatDate(h)}</span>
                  <button
                    type="button"
                    aria-label={`Remove holiday ${formatDate(h)}`}
                    onClick={() => onChange({ ...settings, holidays: settings.holidays.filter((x) => x !== h) })}
                    className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted"
                  >
                    <CloseIcon size={18} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex gap-2">
            <input
              type="date"
              aria-label="Holiday date"
              min={WINDOW_START}
              max={WINDOW_END}
              value={holidayDraft}
              onChange={(e) => setHolidayDraft(e.target.value)}
              className={inputCls}
            />
            <button
              type="button"
              onClick={addHoliday}
              disabled={!holidayOk}
              className="min-h-11 shrink-0 rounded-lg bg-ink px-4 text-sm font-bold text-white disabled:bg-muted disabled:text-subtle"
            >
              Add
            </button>
          </div>

          <h3 className="mt-6 text-sm font-bold">Reset</h3>
          <div className="mt-2 flex flex-col gap-2">
            <button
              type="button"
              disabled={markCount === 0}
              onClick={() => {
                if (window.confirm(`Remove all ${markCount} attended / skipped marks?`)) onResetMarks();
              }}
              className="min-h-11 rounded-lg border-[1.5px] border-ink bg-white px-4 text-sm font-bold hover:bg-empty disabled:border-line disabled:text-subtle"
            >
              Reset marks{markCount > 0 ? ` (${markCount})` : ""}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Reset marks, baseline and every setting to the defaults?")) onResetAll();
              }}
              className="min-h-11 rounded-lg border-[1.5px] border-must-border bg-white px-4 text-sm font-bold text-must-border hover:bg-[#fdecea]"
            >
              Reset everything
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
