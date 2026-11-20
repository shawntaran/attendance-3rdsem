"use client";

import { useId, useRef, useState } from "react";
import type { AttendanceRecord } from "@/lib/config";
import { formatDayMonth } from "@/lib/dates";
import { ImportError, importAttendanceFile, type ImportResult } from "@/lib/recordImport";

interface Props {
  onApply: (record: AttendanceRecord) => void;
  /** Button text before a file is picked. */
  pickLabel?: string;
}

const MAX_FILE_BYTES = 5_000_000;
const MAX_ISSUES_SHOWN = 5;

/**
 * Pick the portal's Daily Attendance export (.xlsx), read it on this device,
 * show what it holds, and hand the record over once confirmed.
 */
export function RecordUpload({ onApply, pickLabel = "Upload attendance (.xlsx)" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function read(file: File) {
    setError(null);
    setResult(null);
    if (file.size > MAX_FILE_BYTES) return setError("That file is too big to be the attendance export.");
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setResult(await importAttendanceFile(bytes, new Date().toISOString()));
    } catch (err) {
      setError(
        err instanceof ImportError
          ? err.message
          : "Could not read that file. Export the Daily Attendance report from the portal as Excel (.xlsx) and try again.",
      );
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
        }}
      />
      {!result && (
        <label
          htmlFor={id}
          className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-ink px-4 text-sm font-bold text-page has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          tabIndex={0}
          role="button"
          aria-busy={busy}
        >
          {busy ? "Reading…" : pickLabel}
        </label>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-must-border">
          {error}
        </p>
      )}
      {result && (
        <div className="rounded-lg border border-line bg-empty p-3 text-sm" role="status">
          <p className="font-bold">
            {formatDayMonth(result.from)} to {formatDayMonth(result.to)}: {result.classDays} class days
            {result.record.holidays.length > 0 ? `, ${result.record.holidays.length} holidays` : ""}
          </p>
          {result.mismatches.length === 0 ? (
            <p className="mt-0.5 text-xs text-subtle">Every day matches the timetable it ran.</p>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-subtle">
                {result.mismatches.length} {result.mismatches.length === 1 ? "day does" : "days do"} not quite match the
                timetable. Those hours are read as recorded; check them in Past record.
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {result.mismatches.slice(0, MAX_ISSUES_SHOWN).map((m) => (
                  <li key={m.date}>
                    {formatDayMonth(m.date)}: {m.message}
                  </li>
                ))}
                {result.mismatches.length > MAX_ISSUES_SHOWN && <li>and {result.mismatches.length - MAX_ISSUES_SHOWN} more</li>}
              </ul>
            </>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setResult(null)}
              className="min-h-11 rounded-lg border-[1.5px] border-line bg-surface px-3 text-sm font-semibold hover:border-teal"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onApply(result.record);
                setResult(null);
              }}
              className="min-h-11 rounded-lg bg-ink px-3 text-sm font-bold text-page"
            >
              Use this record
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The card shown until a person has uploaded their record. */
export function RecordWelcome({ name, onApply }: { name: string; onApply: (record: AttendanceRecord) => void }) {
  return (
    <section aria-labelledby="welcome-title" className="mt-3 rounded-xl border-[1.5px] border-teal bg-surface p-4 desk:p-5">
      <h2 id="welcome-title" className="font-display text-lg font-bold">
        {name === "This device" ? "Add your attendance" : `Hi ${name}, add your attendance`}
      </h2>
      <p className="mt-1 text-sm text-subtle">
        On the portal, open the Daily Attendance report for this semester and download it as Excel. Upload it
        here: every present, absent, DL and suspended hour is placed on the timetable it ran on, and the plan
        starts from your own numbers. The file is read on this device; only the hour codes are saved.
      </p>
      <div className="mt-3 max-w-sm">
        <RecordUpload onApply={onApply} />
      </div>
    </section>
  );
}
