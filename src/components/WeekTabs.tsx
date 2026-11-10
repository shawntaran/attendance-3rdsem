import { WEEKS } from "@/lib/config";
import { fmtHours } from "@/lib/view";

interface Props {
  selected: number;
  greenHoursByWeek: number[];
  onSelect: (index: number) => void;
}

export function WeekTabs({ selected, greenHoursByWeek, onSelect }: Props) {
  return (
    <div role="tablist" aria-label="Week" className="grid grid-cols-4 gap-1.5 desk:flex desk:gap-2">
      {WEEKS.map((week, i) => {
        const active = i === selected;
        const hours = greenHoursByWeek[i];
        return (
          <button
            key={week.id}
            type="button"
            role="tab"
            id={`week-tab-${week.id}`}
            aria-selected={active}
            aria-controls="week-panel"
            aria-label={`${week.label}, ${fmtHours(hours)} skippable`}
            onClick={() => onSelect(i)}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const next = (i + step + WEEKS.length) % WEEKS.length;
              onSelect(next);
              document.getElementById(`week-tab-${WEEKS[next].id}`)?.focus();
            }}
            tabIndex={active ? 0 : -1}
            className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border-[1.5px] px-2 py-1.5 text-sm font-semibold desk:flex-row desk:gap-2 desk:px-4 ${
              active
                ? "border-teal bg-teal text-white"
                : "border-line bg-white text-ink hover:border-teal"
            }`}
          >
            <span className="font-display whitespace-nowrap">{week.label}</span>
            <span
              className={`rounded-full px-1.5 py-px text-[11px] font-bold whitespace-nowrap ${
                active ? "bg-white text-teal-dark" : "bg-ok-bg text-ok-ink"
              }`}
            >
              {hours} h
            </span>
          </button>
        );
      })}
    </div>
  );
}
