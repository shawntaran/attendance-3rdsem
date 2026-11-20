"use client";

import { useState } from "react";
import {
  CLASS_ODS,
  COURSE_NAME,
  TEACHING_HOURS,
  WINDOW_START,
  odCounted,
  type CourseCode,
  type OdLeave,
  type OdSlot,
  type OdState,
  type Settings,
} from "@/lib/config";
import { formatDate, isValidDate } from "@/lib/dates";
import { odDlHours, odHoursByCourse, odHoursTotal } from "@/lib/plan";
import { MAX_REASON_LENGTH } from "@/lib/storage";
import { fmtHours } from "@/lib/view";
import { CloseIcon } from "./icons";

interface Props {
  settings: Settings;
  /** Move focus to this section when the drawer opens. */
  autoFocus: boolean;
  onChange: (next: { ods: OdLeave[]; odState: OdState }) => void;
}

const shortcutBtn =
  "min-h-11 rounded-lg border-[1.5px] border-line bg-surface px-3 text-sm font-semibold hover:border-teal disabled:text-subtle disabled:hover:border-line";
const inputCls = "min-h-11 w-full rounded-lg border-[1.5px] border-field bg-surface px-2.5 py-2 text-sm text-ink";

export function odSummary(settings: Settings): { counted: number; total: number; hours: number } {
  let counted = 0;
  let hours = 0;
  for (const od of settings.ods) {
    if (!odCounted(settings.odState[od.id])) continue;
    counted++;
    hours += odHoursTotal(od, settings);
  }
  return { counted, total: settings.ods.length, hours };
}

/** "hour 3", "hours 1-4", "whole day" */
function hoursLabel(hours: number[]): string {
  if (hours.length === TEACHING_HOURS.length) return "whole day";
  return `${hours.length === 1 ? "hour" : "hours"} ${hours.join(", ")}`;
}

function slotsLabel(slots: OdSlot[]): string {
  return slots.map((s) => `${formatDate(s.date)} · ${hoursLabel(s.hours)}`).join("; ");
}

function newId(slots: OdSlot[]): string {
  const rand = Math.random().toString(36).slice(2, 6);
  return `od-${slots[0].date}-${rand}`;
}

export function OdSection({ settings, autoFocus, onChange }: Props) {
  const { ods, odState } = settings;
  const summary = odSummary(settings);
  const [adding, setAdding] = useState(false);

  function setSwitch(id: string, on: boolean) {
    onChange({ ods, odState: { ...odState, [id]: { ...(odState[id] ?? { inPortal: false }), on, inPortal: false } } });
  }

  function setAll(on: boolean) {
    onChange({ ods, odState: Object.fromEntries(ods.map((od) => [od.id, { on, inPortal: false }])) });
  }

  function remove(od: OdLeave) {
    if (!window.confirm(`Remove the OD "${od.reason}"?`)) return;
    const { [od.id]: _gone, ...rest } = odState;
    onChange({ ods: ods.filter((x) => x.id !== od.id), odState: rest });
  }

  function add(od: OdLeave) {
    onChange({ ods: [...ods, od], odState: { ...odState, [od.id]: { on: true, inPortal: false } } });
    setAdding(false);
  }

  const allOn = ods.every((od) => odState[od.id]?.on);
  const allOff = ods.every((od) => !odState[od.id]?.on);

  return (
    <section aria-labelledby="od-title">
      <h3 id="od-title" tabIndex={-1} data-autofocus={autoFocus ? "" : undefined} className="scroll-mt-4 rounded text-sm font-bold">
        On-duty leaves (OD)
      </h3>
      <p className="mt-0.5 text-xs text-subtle">
        ODs you are still waiting on. On a past day an OD turns those hours&rsquo; absences into present; on a
        day ahead, the classes in those hours count as present. Once the portal shows them as DL, upload your
        record again and the OD has nothing left to do.
      </p>

      {ods.length > 0 && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button type="button" className={shortcutBtn} disabled={allOn} onClick={() => setAll(true)}>
              Count all
            </button>
            <button type="button" className={shortcutBtn} disabled={allOff} onClick={() => setAll(false)}>
              Count none
            </button>
          </div>
          <p className="mt-2 text-sm font-semibold" aria-live="polite">
            Counting {summary.counted} of {summary.total} ODs ({fmtHours(summary.hours)})
          </p>
        </>
      )}

      <ul className="mt-2 flex flex-col gap-2">
        {ods.map((od) => {
          const t = odState[od.id] ?? { on: true, inPortal: false };
          const byCourse = odHoursByCourse(od, settings);
          const total = odHoursTotal(od, settings);
          const titleId = `${od.id}-title`;
          return (
            <li key={od.id} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p id={titleId} className="text-sm font-bold">
                    {od.reason || "OD"}
                  </p>
                  <p className="text-xs text-subtle">{slotsLabel(od.slots)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={t.on}
                    aria-label="Count this OD as present"
                    aria-describedby={titleId}
                    onClick={() => setSwitch(od.id, !t.on)}
                    className="flex h-11 w-12 items-center justify-center rounded-lg"
                  >
                    <span
                      className={`flex h-[26px] w-12 items-center rounded-full border-[1.5px] px-[2px] transition-colors ${
                        t.on ? "justify-end border-teal bg-teal" : "justify-start border-field bg-muted"
                      }`}
                    >
                      <span className={`h-[19px] w-[19px] rounded-full ${t.on ? "bg-white" : "bg-field"}`} />
                    </span>
                  </button>
                  <span className="text-xs font-semibold tabular-nums">{fmtHours(total)}</span>
                </div>
              </div>
              {total > 0 ? (
                <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Hours per course">
                  {(Object.entries(byCourse) as [CourseCode, number][]).map(([code, hours]) => (
                    <li key={code} className="rounded-full bg-empty px-2 py-0.5 text-xs font-medium">
                      {COURSE_NAME[code]} +{hours}
                    </li>
                  ))}
                </ul>
              ) : null}
              <DlNote od={od} settings={settings} total={total} />
              <button
                type="button"
                onClick={() => remove(od)}
                className="mt-1 min-h-11 text-sm font-semibold text-must-border underline underline-offset-2"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>

      <ClassOds settings={settings} onAdd={add} />

      {adding ? (
        <AddOdForm onAdd={add} onCancel={() => setAdding(false)} windowEnd={settings.windowEnd} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 min-h-11 w-full rounded-lg border-[1.5px] border-dashed border-field px-4 text-sm font-bold hover:border-teal"
        >
          + Add an OD
        </button>
      )}
    </section>
  );
}

function AddOdForm({ onAdd, onCancel, windowEnd }: { onAdd: (od: OdLeave) => void; onCancel: () => void; windowEnd: string }) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState<OdSlot[]>([{ date: "", hours: [...TEACHING_HOURS] }]);
  const [error, setError] = useState<string | null>(null);

  function setDay(i: number, patch: Partial<OdSlot>) {
    setDays((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  function toggleHour(i: number, h: number) {
    const cur = days[i].hours;
    setDay(i, { hours: cur.includes(h) ? cur.filter((x) => x !== h) : [...cur, h].sort((a, b) => a - b) });
  }

  function save() {
    const slots = days.filter((d) => d.date);
    if (slots.length === 0) return setError("Pick at least one day.");
    if (slots.some((d) => !isValidDate(d.date))) return setError("One of the dates is not valid.");
    if (new Set(slots.map((d) => d.date)).size !== slots.length) return setError("Each day can be listed once.");
    if (slots.some((d) => d.hours.length === 0)) return setError("Tick at least one hour for each day.");
    if (slots.some((d) => d.date > windowEnd)) return setError("A day is after the end of the plan.");
    const sorted = [...slots].sort((a, b) => a.date.localeCompare(b.date));
    onAdd({ id: newId(sorted), reason: reason.trim() || "OD", slots: sorted });
  }

  return (
    <fieldset className="mt-2 rounded-lg border border-dashed border-field p-3">
      <legend className="px-1 text-xs font-semibold">Add an OD</legend>
      <label className="block text-xs font-semibold">
        What for
        <input
          type="text"
          value={reason}
          maxLength={MAX_REASON_LENGTH}
          placeholder="e.g. Hackathon"
          onChange={(e) => setReason(e.target.value)}
          className={`${inputCls} mt-0.5 font-normal`}
        />
      </label>
      {days.map((d, i) => (
        <div key={i} className="mt-3 rounded-lg bg-empty p-2">
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs font-semibold">
              Day {days.length > 1 ? i + 1 : ""}
              <input
                type="date"
                min="2026-07-01"
                max={windowEnd}
                value={d.date}
                onChange={(e) => setDay(i, { date: e.target.value })}
                className={`${inputCls} mt-0.5 font-normal`}
              />
            </label>
            {days.length > 1 && (
              <button
                type="button"
                aria-label={`Remove day ${i + 1}`}
                onClick={() => setDays((x) => x.filter((_, j) => j !== i))}
                className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted"
              >
                <CloseIcon size={18} />
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label={`Hours on day ${i + 1}`}>
            {TEACHING_HOURS.map((h) => {
              const on = d.hours.includes(h);
              return (
                <button
                  key={h}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Hour ${h}`}
                  onClick={() => toggleHour(i, h)}
                  className={`h-10 min-w-10 rounded-lg border-[1.5px] text-sm font-bold ${
                    on ? "border-teal bg-teal text-white" : "border-field bg-surface text-ink"
                  }`}
                >
                  {h}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setDay(i, { hours: d.hours.length === TEACHING_HOURS.length ? [] : [...TEACHING_HOURS] })}
              className="ml-1 min-h-10 rounded-lg px-2 text-xs font-semibold underline underline-offset-2"
            >
              {d.hours.length === TEACHING_HOURS.length ? "Clear" : "Whole day"}
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setDays((x) => [...x, { date: "", hours: [...TEACHING_HOURS] }])}
        className="mt-2 min-h-11 text-sm font-semibold underline underline-offset-2"
      >
        + Another day
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs font-semibold text-must-border">
          {error}
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className={shortcutBtn}>
          Cancel
        </button>
        <button type="button" onClick={save} className="min-h-11 rounded-lg bg-ink px-4 text-sm font-bold text-page">
          Add OD
        </button>
      </div>
      <p className="mt-2 text-[11px] text-subtle">Days from {formatDate(WINDOW_START)} on can be in the plan; earlier days use your record.</p>
    </fieldset>
  );
}

/** Why an OD adds nothing, or what part of it the portal already counts. */
function DlNote({ od, settings, total }: { od: OdLeave; settings: Settings; total: number }) {
  const dl = odDlHours(od, settings);
  if (dl > 0) {
    return (
      <p className="mt-1.5 text-xs text-ok-ink">
        {fmtHours(dl)} already DL in your record, so already counted as present
        {total > 0 ? "; the hours above are on top of that." : "."}
      </p>
    );
  }
  if (total > 0) return null;
  return (
    <p className="mt-1.5 text-xs text-subtle">
      {settings.record
        ? "Nothing to count: you were marked present in those hours."
        : "Upload your record to count past days."}
    </p>
  );
}

/** The ODs the class was given, for adding with one tap. Hides the ones already in your list. */
function ClassOds({ settings, onAdd }: { settings: Settings; onAdd: (od: OdLeave) => void }) {
  const have = new Set(settings.ods.map((o) => o.id));
  const offer = CLASS_ODS.filter((o) => !have.has(o.id));
  if (offer.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border border-line bg-surface" open={settings.ods.length === 0}>
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-bold">
        Class ODs ({offer.length})
      </summary>
      <p className="px-3 text-xs text-subtle">
        ODs the class was given. Add the ones you went to: absences in those hours count as present.
      </p>
      <ul className="mt-1 flex flex-col">
        {offer.map((od) => {
          const add = odHoursTotal(od, settings);
          const dl = odDlHours(od, settings);
          const effect =
            add > 0
              ? `+${fmtHours(add)} for you`
              : dl > 0
                ? "already DL in your record"
                : settings.record
                  ? "you were present then"
                  : "";
          return (
            <li key={od.id} className="flex items-center gap-3 border-t border-line px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{od.reason}</p>
                <p className="text-xs text-subtle">
                  {slotsLabel(od.slots)}
                  {effect ? ` · ${effect}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onAdd(structuredClone(od))}
                aria-label={`Add ${od.reason}`}
                className="min-h-11 shrink-0 rounded-lg border-[1.5px] border-teal px-3 text-sm font-bold hover:bg-teal hover:text-white"
              >
                Add
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
