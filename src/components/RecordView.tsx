"use client";

import { useMemo, useState } from "react";
import { BASELINE_AS_OF, COURSES, COURSE_NAME, PERIODS } from "@/lib/config";
import { addDays, formatDate, formatDayMonth, weekdayName } from "@/lib/dates";
import {
  COUNT_SUSPENDED_AS_ABSENT,
  HISTORY_FROM,
  HISTORY_TO,
  historyTotals,
  historyWeeks,
  TIMETABLE_CHANGED_ON,
  type HistoryClass,
  type HourStatus,
} from "@/lib/history";
import { fmtPct } from "@/lib/view";
import { AlertCircleIcon, CheckCircleIcon, SkipIcon } from "./icons";

// Same column layout as the plan grid: day | 1 | 2 | break | 3 | 4 | lunch | 6 | break | 7 | 8
const COLUMN_OF_PERIOD: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 6, 6: 8, 7: 10, 8: 11 };
const BANDS = [
  { column: 4, label: "Break" },
  { column: 7, label: "Lunch break" },
  { column: 9, label: "Break" },
];
const MUTED_BLOCKS: [number, number][] = [
  [2, 2],
  [5, 2],
  [8, 1],
  [10, 2],
];

const LABEL: Record<HourStatus, string> = { present: "Present", dl: "OD (DL)", absent: "Absent", suspended: "Suspended" };
const STATE: Record<HourStatus, string> = {
  present: "state-attended",
  dl: "state-skip-ok",
  absent: "state-attend",
  suspended: "state-skipped",
};

function StatusMark({ status, size = 14 }: { status: HourStatus; size?: number }) {
  if (status === "absent") return <AlertCircleIcon size={size} />;
  if (status === "suspended") return <SkipIcon size={size} />;
  return <CheckCircleIcon size={size} />;
}

/** A class's look: its one status, or the worst of a lab's two hours. */
function classStatus(cls: HistoryClass): HourStatus {
  const order: HourStatus[] = ["absent", "suspended", "dl", "present"];
  return order.find((s) => cls.hours.includes(s)) ?? "present";
}

function classLabel(cls: HistoryClass): string {
  const unique = [...new Set(cls.hours)];
  return unique.length === 1 ? LABEL[unique[0]] : cls.hours.map((h) => LABEL[h]).join(" + ");
}

function ariaFor(cls: HistoryClass): string {
  return `${COURSE_NAME[cls.course]}, ${formatDate(cls.date)}, ${cls.span > 1 ? `${cls.span} hours, ` : ""}${classLabel(cls)}`;
}

interface Props {
  isDesktop: boolean;
}

/** The past record as timetable weeks: every class marked present, absent, OD or suspended. */
export function RecordView({ isDesktop }: Props) {
  const weeks = useMemo(() => historyWeeks(), []);
  const [index, setIndex] = useState(weeks.length - 1);
  const week = weeks[index];
  const totals = useMemo(() => historyTotals(BASELINE_AS_OF), []);
  const changeWeek = TIMETABLE_CHANGED_ON > week.monday && TIMETABLE_CHANGED_ON <= addDays(week.monday, 4);

  return (
    <div className="mt-2 desk:mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="Previous week"
          className="min-h-11 min-w-11 rounded-lg border-[1.5px] border-line bg-surface px-3 text-sm font-semibold hover:border-teal disabled:opacity-40"
        >
          ←
        </button>
        <label className="text-sm font-semibold">
          <span className="sr-only">Week</span>
          <select
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            className="min-h-11 rounded-lg border-[1.5px] border-field bg-surface px-2.5 text-sm text-ink"
          >
            {weeks.map((w, i) => (
              <option key={w.monday} value={i}>
                Week of {formatDayMonth(w.monday)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(weeks.length - 1, i + 1))}
          disabled={index === weeks.length - 1}
          aria-label="Next week"
          className="min-h-11 min-w-11 rounded-lg border-[1.5px] border-line bg-surface px-3 text-sm font-semibold hover:border-teal disabled:opacity-40"
        >
          →
        </button>
        <span className="rounded-full bg-empty px-2.5 py-1 text-xs font-semibold">
          {changeWeek
            ? `Old timetable until 16 Sep, current from 17 Sep`
            : week.oldTimetable
              ? "Old timetable"
              : "Current timetable"}
        </span>
      </div>

      <div className="mt-3">
        {isDesktop ? <RecordGrid week={week} /> : <RecordList week={week} />}
      </div>

      <RecordKey />

      <section aria-labelledby="record-totals" className="mt-4 rounded-xl border border-line bg-surface p-4 desk:p-5">
        <h2 id="record-totals" className="font-display text-base font-bold desk:text-lg">
          Record by course, {formatDayMonth(HISTORY_FROM)} to {formatDayMonth(BASELINE_AS_OF)}
        </h2>
        <p className="mt-0.5 text-xs text-subtle">
          This is the baseline the plan starts from. DL counts as present
          {COUNT_SUSPENDED_AS_ABSENT ? "; suspended hours count as held but not attended" : ""}. Classes from{" "}
          {formatDayMonth(addDays(BASELINE_AS_OF, 1))} to {formatDayMonth(HISTORY_TO)} are in the plan as marks.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-subtle">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Course</th>
                <th scope="col" className="px-2 py-1.5 text-right font-semibold">Present / held</th>
                <th scope="col" className="px-2 py-1.5 text-right font-semibold">%</th>
                <th scope="col" className="px-2 py-1.5 text-right font-semibold">OD (DL)</th>
                <th scope="col" className="px-2 py-1.5 text-right font-semibold">Absent</th>
                <th scope="col" className="py-1.5 pl-2 text-right font-semibold">Suspended</th>
              </tr>
            </thead>
            <tbody>
              {COURSES.map((c) => {
                const t = totals[c.code];
                return (
                  <tr key={c.code} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      {c.name} <span className="text-subtle">{c.code}</span>
                    </th>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {t.present} / {t.held}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtPct((t.present / Math.max(1, t.held)) * 100)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.dl}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{t.absent}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums">{t.suspended}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function RecordKey() {
  const items: HourStatus[] = ["present", "dl", "absent", "suspended"];
  return (
    <ul className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Key">
      {items.map((s) => (
        <li key={s} className={`${STATE[s]} inline-flex items-center gap-1 rounded-full border-[1.5px] px-2 py-1 font-bold`}>
          <StatusMark status={s} size={13} />
          {LABEL[s]}
        </li>
      ))}
    </ul>
  );
}

type WeekData = ReturnType<typeof historyWeeks>[number];

function RecordGrid({ week }: { week: WeekData }) {
  const rows = week.days.length;
  return (
    <div
      className="grid gap-1.5"
      style={{
        gridTemplateColumns:
          "minmax(92px, 1.05fr) repeat(2, minmax(0, 1fr)) 26px repeat(2, minmax(0, 1fr)) 36px minmax(0, 1fr) 26px repeat(2, minmax(0, 1fr))",
        gridTemplateRows: `auto repeat(${rows}, minmax(80px, auto))`,
      }}
    >
      {PERIODS.map((p) => (
        <div key={p.n} className="rounded-lg bg-teal px-1 py-2 text-center text-white" style={{ gridColumn: COLUMN_OF_PERIOD[p.n], gridRow: 1 }}>
          <div className="font-display text-lg leading-tight font-bold">
            <span className="sr-only">Period </span>
            {p.n}
          </div>
          <div className="text-[11px] leading-tight">
            {p.start.replace(/^0/, "")}–{p.end.replace(/^0/, "")}
          </div>
        </div>
      ))}
      {BANDS.map((b) => (
        <div
          key={b.column}
          className="flex items-center justify-center rounded-lg bg-band text-ink"
          style={{ gridColumn: b.column, gridRow: `2 / span ${rows}` }}
        >
          <span className="vertical-text text-[11px] font-semibold tracking-wide">{b.label}</span>
        </div>
      ))}
      {week.days.map(({ date, day }, i) => {
        const row = i + 2;
        const muted = !day || day.holiday !== null;
        const note = !day ? "Not in the record" : day.holiday;
        const taken = new Set<number>();
        for (const c of day?.classes ?? []) for (let k = 0; k < c.span; k++) taken.add(c.startPeriod + k);
        return (
          <div key={date} className="contents">
            <div
              className={`flex flex-col justify-center rounded-lg px-3 py-2 ${muted ? "bg-mutedday text-ink" : "bg-raised text-white"}`}
              style={{ gridColumn: 1, gridRow: row }}
            >
              <div className="font-display text-xl leading-tight font-bold">{weekdayName(date)}</div>
              <div className="text-xs">{formatDayMonth(date)}</div>
              {day?.note && (
                <span className="mt-1 w-fit rounded-full border border-current px-1.5 py-px text-[10px] leading-tight font-bold">
                  {day.note}
                </span>
              )}
            </div>
            {muted
              ? MUTED_BLOCKS.map(([col, span], b) => (
                  <div
                    key={col}
                    className="flex items-center rounded-lg bg-muted px-3 text-xs font-semibold text-subtle"
                    style={{ gridColumn: `${col} / span ${span}`, gridRow: row }}
                  >
                    {b === 0 ? note : null}
                  </div>
                ))
              : PERIODS.filter((p) => !taken.has(p.n)).map((p) => (
                  <div key={p.n} className="rounded-lg bg-empty" style={{ gridColumn: COLUMN_OF_PERIOD[p.n], gridRow: row }} />
                ))}
            {(day?.classes ?? []).map((cls) => {
              const status = classStatus(cls);
              return (
                <div
                  key={cls.startPeriod}
                  role="img"
                  aria-label={ariaFor(cls)}
                  className={`${STATE[status]} flex min-w-0 flex-col rounded-lg border-[1.5px] px-2 py-1.5`}
                  style={{ gridColumn: `${COLUMN_OF_PERIOD[cls.startPeriod]} / span ${cls.span}`, gridRow: row }}
                >
                  <span className="font-display text-[13px] leading-tight font-bold [overflow-wrap:anywhere] xl:text-[15px]">
                    {COURSE_NAME[cls.course]}
                  </span>
                  <span className="text-[11px] leading-snug opacity-90 xl:text-xs">{cls.course}</span>
                  <span className="mt-auto flex items-center gap-1 pt-1.5 text-[11px] leading-tight font-bold xl:text-xs">
                    <StatusMark status={status} />
                    {classLabel(cls)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function RecordList({ week }: { week: WeekData }) {
  return (
    <div className="flex flex-col gap-3">
      {week.days.map(({ date, day }) => {
        if (!day || day.holiday !== null) {
          return (
            <div key={date} className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2.5 text-sm text-subtle">
              <span className="font-display font-bold text-ink">
                {weekdayName(date)} {formatDayMonth(date)}
              </span>
              <span className="text-right font-medium">{day?.holiday ?? "Not in the record"}</span>
            </div>
          );
        }
        return (
          <section key={date} className="overflow-hidden rounded-xl border border-line bg-surface">
            <h3 className="flex flex-wrap items-center gap-x-2 bg-raised px-3 py-2 text-white">
              <span className="font-display text-lg font-bold">{weekdayName(date)}</span>
              <span className="text-sm">{formatDayMonth(date)}</span>
              {day.note && <span className="rounded-full border border-current px-1.5 py-px text-[11px] font-bold">{day.note}</span>}
            </h3>
            <ul className="flex flex-col gap-1.5 p-1.5">
              {day.classes.map((cls) => {
                const status = classStatus(cls);
                const first = PERIODS.find((p) => p.n === cls.startPeriod)!;
                const last = PERIODS.find((p) => p.n === cls.startPeriod + cls.span - 1)!;
                return (
                  <li
                    key={cls.startPeriod}
                    aria-label={ariaFor(cls)}
                    className={`${STATE[status]} flex min-h-12 items-center gap-3 rounded-lg border-[1.5px] px-3 py-2`}
                  >
                    <span className="w-11 shrink-0 text-xs leading-tight font-semibold tabular-nums">
                      {first.start}
                      <br />
                      {last.end}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-[15px] leading-tight font-bold">{COURSE_NAME[cls.course]}</span>
                      <span className="block text-xs opacity-90">{cls.course}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-bold">
                      <StatusMark status={status} size={15} />
                      {classLabel(cls)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
