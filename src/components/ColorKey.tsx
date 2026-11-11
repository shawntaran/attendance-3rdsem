import { ODS, type Settings } from "@/lib/config";
import { formatDayMonth } from "@/lib/dates";
import type { SessionStatus } from "@/lib/plan";
import { STATUS_LABEL, endLabel, fmtHours, windowLabel } from "@/lib/view";
import { odSummary } from "./OdSection";
import { StatusIcon } from "./icons";

function Swatch({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`state-${status} flex h-10 w-[104px] shrink-0 items-center justify-center gap-1 rounded-lg border-[1.5px] text-xs font-bold`}
    >
      <StatusIcon status={status} size={14} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ColorKey({ settings }: { settings: Settings }) {
  const t = settings.targetPct;
  const end = endLabel(settings.windowEnd);
  const od = odSummary(settings.odState);
  const cushion =
    settings.cushionHours > 0 ? `, with ${fmtHours(settings.cushionHours).replace("hrs", "hours").replace("hr", "hour")} to spare` : "";
  const rows: [SessionStatus, string][] = [
    ["skip-ok", `You can miss this class and still finish the course at ${t}% or more on ${end}${cushion}.`],
    ["attend", `Go. Skipping this one risks pushing the course under ${t}% by ${end}.`],
    ["attended", "You went. Past days with no mark are assumed attended."],
    ["skipped", "You missed it. Its hours came out of that course's allowance."],
  ];
  return (
    <section aria-labelledby="key-title" className="rounded-xl border border-line bg-surface p-4 desk:p-5">
      <h2 id="key-title" className="font-display text-base font-bold desk:text-lg">
        Color key
      </h2>
      <ul className="mt-3 flex flex-col gap-2.5 text-sm">
        {rows.map(([status, text]) => (
          <li key={status} className="flex items-center gap-3">
            <Swatch status={status} />
            <span>{text}</span>
          </li>
        ))}
        <li className="flex items-center gap-3">
          <span className="h-10 w-[104px] shrink-0 rounded-lg bg-muted" aria-hidden="true" />
          <span>No class, a holiday, or outside the {windowLabel(settings.windowEnd)} plan.</span>
        </li>
      </ul>
      <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-subtle">
        Based on portal attendance through {formatDayMonth(settings.baselineAsOf)}, plus {od.counted} of{" "}
        {ODS.length} ODs counted as present.{" "}
        Each course&rsquo;s green slots add up to its limit, so skipping any extra class breaks it. Green
        slots are placed as late as possible, so skips pile up in the final weeks.
      </p>
    </section>
  );
}
