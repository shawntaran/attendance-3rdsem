import { formatDate } from "@/lib/dates";

interface Props {
  date: string;
  off: boolean;
  onToggle: (date: string) => void;
  /** "dark": on the dark day label; "light": on a muted (light) one. */
  tone: "dark" | "light";
  size?: "sm" | "md";
}

/**
 * The what-if switch on a day's title. On = classes as normal; off = preview
 * the plan as if the day were a holiday.
 */
export function DayToggle({ date, off, onToggle, tone, size = "md" }: Props) {
  const on = !off;
  const label = formatDate(date);
  const track = on
    ? "border-today bg-today"
    : tone === "dark"
      ? "border-white/70 bg-transparent"
      : "border-field bg-transparent";
  const knob = on ? "bg-[#14202b]" : tone === "dark" ? "bg-white/80" : "bg-field";
  const sm = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Classes on ${label}`}
      title={on ? `Turn off to see ${label} as a holiday` : `${label} is off in the what-if. Turn back on.`}
      onClick={() => onToggle(date)}
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${sm ? "h-8 min-w-10" : "h-11 min-w-11"}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-[18px] w-8 items-center rounded-full border-[1.5px] px-[2px] transition-colors motion-reduce:transition-none ${track} ${
          on ? "justify-end" : "justify-start"
        }`}
      >
        <span className={`h-3 w-3 rounded-full ${knob}`} />
      </span>
    </button>
  );
}
