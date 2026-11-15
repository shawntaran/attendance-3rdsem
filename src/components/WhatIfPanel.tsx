import { formatDate } from "@/lib/dates";
import type { WhatIfSummary } from "@/lib/whatIf";
import { fmtHours, fmtPct } from "@/lib/view";
import { CloseIcon } from "./icons";

interface Props {
  offDays: string[];
  summary: WhatIfSummary;
  targetPct: number;
  endLabel: string;
  onRestore: (date: string) => void;
  onReset: () => void;
}

function Change({ from, to, pct, target }: { from: number; to: number; pct?: boolean; target?: number }) {
  const fmt = (v: number) => (pct ? fmtPct(v) : String(v));
  const delta = to - from;
  const same = Math.abs(delta) < 1e-9;
  const below = pct && target !== undefined && to < target - 1e-9;
  const sign = delta > 0 ? "+" : "−";
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-subtle">{fmt(from)}</span>
      <span aria-hidden="true" className="px-1 text-subtle">
        →
      </span>
      <span className="sr-only"> becomes </span>
      <strong className={below ? "text-must-border" : ""}>{fmt(to)}</strong>
      {!same && (
        <span className="ml-1 text-xs text-subtle">
          ({sign}
          {pct ? Math.abs(delta).toFixed(1) : Math.abs(delta)}
          {pct ? " pts" : ""})
        </span>
      )}
    </span>
  );
}

/** The what-if result: which days are off and what that does to each affected course. */
export function WhatIfPanel({ offDays, summary, targetPct, endLabel, onRestore, onReset }: Props) {
  const sorted = [...offDays].sort();
  const [greensBefore, greensAfter] = summary.totalGreenHours;
  return (
    <section
      aria-labelledby="what-if-title"
      className="mt-3 rounded-xl border-[1.5px] border-dashed border-teal bg-surface p-3 desk:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="what-if-title" className="font-display text-base font-bold">
            What if {sorted.length === 1 ? "this day was a holiday" : "these days were holidays"}
          </h2>
          <p className="text-xs text-subtle">
            A preview only: your real holidays and marks are unchanged, and nothing is synced. Final % is on{" "}
            {endLabel}.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="min-h-11 shrink-0 rounded-lg border-[1.5px] border-line px-3 text-sm font-semibold hover:border-teal"
        >
          Turn all back on
        </button>
      </div>

      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Days switched off">
        {sorted.map((d) => (
          <li key={d}>
            <button
              type="button"
              onClick={() => onRestore(d)}
              aria-label={`Turn ${formatDate(d)} back on`}
              className="inline-flex min-h-9 items-center gap-1 rounded-full bg-empty py-1 pr-1.5 pl-3 text-sm font-semibold hover:bg-muted"
            >
              {formatDate(d)}
              <CloseIcon size={14} />
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-sm">
        Skippable hours in the plan: <Change from={greensBefore} to={greensAfter} />
      </p>

      {/* Desktop: table. Phone: one card per course. */}
      <table className="mt-2 hidden w-full border-collapse text-sm desk:table">
        <thead>
          <tr className="border-b border-line text-left text-xs text-subtle">
            <th scope="col" className="py-1.5 pr-3 font-semibold">Course</th>
            <th scope="col" className="px-3 py-1.5 font-semibold">Classes removed</th>
            <th scope="col" className="px-3 py-1.5 font-semibold">Final % if I attend all</th>
            <th scope="col" className="px-3 py-1.5 font-semibold">Final % if I skip all greens</th>
            <th scope="col" className="py-1.5 pl-3 font-semibold">Skip budget</th>
          </tr>
        </thead>
        <tbody>
          {summary.courses.map((c) => (
            <tr key={c.code} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                {c.name} <span className="text-subtle">{c.code}</span>
              </th>
              <td className="px-3 py-2 tabular-nums">{fmtHours(c.hoursRemoved)}</td>
              <td className="px-3 py-2">
                <Change from={c.finalIfAttendAll[0]} to={c.finalIfAttendAll[1]} pct target={targetPct} />
              </td>
              <td className="px-3 py-2">
                <Change from={c.finalIfSkipGreens[0]} to={c.finalIfSkipGreens[1]} pct target={targetPct} />
              </td>
              <td className="py-2 pl-3">
                <Change from={c.budget[0]} to={c.budget[1]} /> <span className="text-xs text-subtle">hrs</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-2 flex flex-col gap-2 desk:hidden">
        {summary.courses.map((c) => (
          <li key={c.code} className="rounded-lg bg-empty px-3 py-2">
            <p className="text-sm font-semibold">
              {c.name} <span className="text-xs font-normal text-subtle">· {fmtHours(c.hoursRemoved)} removed</span>
            </p>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-subtle">Attend all</dt>
              <dd>
                <Change from={c.finalIfAttendAll[0]} to={c.finalIfAttendAll[1]} pct target={targetPct} />
              </dd>
              <dt className="text-subtle">Skip all greens</dt>
              <dd>
                <Change from={c.finalIfSkipGreens[0]} to={c.finalIfSkipGreens[1]} pct target={targetPct} />
              </dd>
              <dt className="text-subtle">Skip budget</dt>
              <dd>
                <Change from={c.budget[0]} to={c.budget[1]} /> hrs
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
