import { COURSE_NAME, PERIODS } from "@/lib/config";
import { formatDayMonth, weekdayName } from "@/lib/dates";
import type { PlanSession } from "@/lib/plan";
import { STATUS_LABEL, cellAriaLabel, type DayView } from "@/lib/view";
import { StatusIcon } from "./icons";

// Grid columns: day | 1 | 2 | break | 3 | 4 | lunch | 6 | break | 7 | 8
const COLUMN_OF_PERIOD: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 6, 6: 8, 7: 10, 8: 11 };
const BANDS = [
  { column: 4, label: "Break" },
  { column: 7, label: "Lunch break" },
  { column: 9, label: "Break" },
];
// Blocks a muted day is drawn in (start column, columns covered).
const MUTED_BLOCKS: [number, number][] = [
  [2, 2],
  [5, 2],
  [8, 1],
  [10, 2],
];

interface Props {
  days: DayView[];
  today: string;
  pulseIds: Set<string>;
  pulseKey: number;
  onOpen: (session: PlanSession, trigger: HTMLElement) => void;
}

export function DesktopGrid({ days, today, pulseIds, pulseKey, onOpen }: Props) {
  return (
    <div
      className="grid gap-1.5"
      style={{
        gridTemplateColumns:
          "minmax(92px, 1.05fr) repeat(2, minmax(0, 1fr)) 26px repeat(2, minmax(0, 1fr)) 36px minmax(0, 1fr) 26px repeat(2, minmax(0, 1fr))",
        gridTemplateRows: "auto repeat(5, minmax(88px, auto))",
      }}
    >
      {PERIODS.map((p) => (
        <div
          key={p.n}
          className="rounded-lg bg-teal px-1 py-2 text-center text-white"
          style={{ gridColumn: COLUMN_OF_PERIOD[p.n], gridRow: 1 }}
        >
          <div className="font-display text-lg leading-tight font-bold">
            <span className="sr-only">Period </span>
            {p.n}
          </div>
          <div className="text-[11px] leading-tight">
            {p.start.replace(/^0/, "")}–{p.end.replace(/^0/, "")}
          </div>
        </div>
      ))}

      {BANDS.map((band) => (
        <div
          key={band.column}
          className="flex items-center justify-center rounded-lg bg-band text-ink"
          style={{ gridColumn: band.column, gridRow: "2 / span 5" }}
        >
          <span className="vertical-text text-[11px] font-semibold tracking-wide">{band.label}</span>
        </div>
      ))}

      {days.map((day, i) => {
        const row = i + 2;
        const isToday = day.date === today;
        const muted = day.mutedNote !== null;
        const taken = new Set<number>();
        for (const s of day.sessions) {
          for (let k = 0; k < s.span; k++) taken.add(s.startPeriod + k);
        }
        return (
          <div key={day.date} className="contents">
            <div
              className={`flex flex-col justify-center rounded-lg px-3 py-2 ${
                muted ? "bg-mutedday text-ink" : "bg-raised text-white"
              }`}
              style={{ gridColumn: 1, gridRow: row }}
            >
              <div className="font-display text-xl leading-tight font-bold">{weekdayName(day.date)}</div>
              <div className="text-xs">{formatDayMonth(day.date)}</div>
              {isToday && (
                <span className="mt-1 w-fit rounded-full bg-today px-2 py-px text-[10px] font-bold text-[#14202b]">
                  Today
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
                    {b === 0 ? day.mutedNote : null}
                  </div>
                ))
              : PERIODS.filter((p) => !taken.has(p.n)).map((p) => (
                  <div
                    key={p.n}
                    className="rounded-lg bg-empty"
                    style={{ gridColumn: COLUMN_OF_PERIOD[p.n], gridRow: row }}
                  />
                ))}

            {day.sessions.map((s) => (
              <button
                key={pulseIds.has(s.id) ? `${s.id}:${pulseKey}` : s.id}
                type="button"
                data-session-id={s.id}
                aria-label={cellAriaLabel(s)}
                aria-haspopup="dialog"
                onClick={(e) => onOpen(s, e.currentTarget)}
                className={`cell-btn state-${s.status} flex min-w-0 flex-col rounded-lg border-[1.5px] px-2 py-1.5 text-left ${
                  pulseIds.has(s.id) ? "cell-pulse" : ""
                }`}
                style={{
                  gridColumn: `${COLUMN_OF_PERIOD[s.startPeriod]} / span ${s.span}`,
                  gridRow: row,
                }}
              >
                <span className="font-display text-[13px] leading-tight font-bold [overflow-wrap:anywhere] xl:text-[15px]">
                  {COURSE_NAME[s.course]}
                </span>
                <span className="text-[11px] leading-snug opacity-90 xl:text-xs">{s.course}</span>
                <span className="mt-auto flex flex-wrap items-center gap-x-1 pt-1.5 text-[11px] leading-tight font-bold xl:text-xs">
                  <StatusIcon status={s.status} size={14} className="shrink-0" />
                  {STATUS_LABEL[s.status]}
                  {s.status === "assumed" && <span className="font-medium">(Assumed)</span>}
                </span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
