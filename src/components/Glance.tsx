import { WEEKS } from "@/lib/config";
import { formatDayMonth } from "@/lib/dates";

interface Props {
  greenHoursByWeek: number[];
  total: number;
  selected: number;
}

/** "Plan at a glance": green (skippable) hours per week. */
export function Glance({ greenHoursByWeek, total, selected }: Props) {
  const max = Math.max(1, ...greenHoursByWeek);
  return (
    <section aria-labelledby="glance-title" className="rounded-xl border border-line bg-white p-3 desk:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="glance-title" className="font-display text-base font-bold">
          Plan at a glance
        </h2>
        <p className="text-sm text-subtle">
          <strong className="text-ink">{total} hrs</strong> skippable in total
        </p>
      </div>
      <ul className="mt-2 grid grid-cols-4 gap-2 desk:gap-3">
        {WEEKS.map((week, i) => (
          <li key={week.id} className={`rounded-lg px-2 py-1.5 ${i === selected ? "bg-empty" : ""}`}>
            <div className="flex items-baseline justify-between gap-1">
              <span className="text-xs font-semibold">
                <span className="desk:hidden">W{week.id}</span>
                <span className="hidden desk:inline">{week.label}</span>
              </span>
              <span className="hidden text-[11px] text-subtle desk:inline">
                {formatDayMonth(week.from)} to {formatDayMonth(week.to)}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-2 rounded-full bg-ok-border"
                style={{ width: `${(greenHoursByWeek[i] / max) * 100}%` }}
              />
            </div>
            <div className="mt-1 text-sm font-bold tabular-nums">
              {greenHoursByWeek[i]} <span className="text-xs font-medium text-subtle">hrs green</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
