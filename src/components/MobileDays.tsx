import { COURSE_NAME, sessionTimes } from "@/lib/config";
import { formatDayMonth, weekdayName } from "@/lib/dates";
import type { PlanSession } from "@/lib/plan";
import { STATUS_LABEL, cellAriaLabel, type DayView } from "@/lib/view";
import { StatusIcon } from "./icons";

interface Props {
  days: DayView[];
  today: string;
  pulseIds: Set<string>;
  pulseKey: number;
  onOpen: (session: PlanSession, trigger: HTMLElement) => void;
}

export function MobileDays({ days, today, pulseIds, pulseKey, onOpen }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {days.map((day) => {
        if (day.mutedNote !== null) {
          return (
            <div
              key={day.date}
              className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2.5 text-sm text-subtle"
            >
              <span className="font-display font-bold text-ink">
                {weekdayName(day.date)} {formatDayMonth(day.date)}
              </span>
              <span className="text-right font-medium">{day.mutedNote}</span>
            </div>
          );
        }
        const isToday = day.date === today;
        return (
          <section key={day.date} className="overflow-hidden rounded-xl border border-line bg-surface">
            <h2 className="flex items-center gap-2 bg-raised px-3 py-2 text-white">
              <span className="font-display text-lg font-bold">{weekdayName(day.date)}</span>
              <span className="text-sm">{formatDayMonth(day.date)}</span>
              {isToday && (
                <span className="ml-auto rounded-full bg-today px-2 py-0.5 text-[11px] font-bold text-[#14202b]">
                  Today
                </span>
              )}
            </h2>
            <ul className="flex flex-col gap-1.5 p-1.5">
              {day.sessions.map((s) => {
                const t = sessionTimes(s.startPeriod, s.span);
                return (
                  <li key={s.id}>
                    <button
                      key={pulseIds.has(s.id) ? `${s.id}:${pulseKey}` : s.id}
                      type="button"
                      data-session-id={s.id}
                      aria-label={cellAriaLabel(s)}
                      aria-haspopup="dialog"
                      onClick={(e) => onOpen(s, e.currentTarget)}
                      className={`cell-btn state-${s.status} flex min-h-14 w-full items-center gap-3 rounded-lg border-[1.5px] px-3 py-2 text-left ${
                        pulseIds.has(s.id) ? "cell-pulse" : ""
                      }`}
                    >
                      <span className="w-11 shrink-0 text-xs leading-tight font-semibold tabular-nums">
                        {t.start}
                        <br />
                        {t.end}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-[15px] leading-tight font-bold">
                          {COURSE_NAME[s.course]}
                        </span>
                        <span className="block text-xs opacity-90">
                          {s.course}
                          {s.span > 1 ? ` · ${s.span} hrs` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end text-xs leading-tight font-bold">
                        <span className="flex items-center gap-1">
                          <StatusIcon status={s.status} size={15} />
                          {STATUS_LABEL[s.status]}
                        </span>
                        {s.status === "assumed" && <span className="font-medium">Assumed</span>}
                      </span>
                    </button>
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
