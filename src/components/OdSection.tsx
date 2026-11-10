import {
  COURSE_NAME,
  ODS,
  OD_TOTAL_HOURS,
  odCounted,
  odTotalHours,
  type CourseCode,
  type OdState,
  type OdToggle,
} from "@/lib/config";
import { formatDate } from "@/lib/dates";
import { fmtHours } from "@/lib/view";

interface Props {
  odState: OdState;
  /** Move focus to this section when the drawer opens. */
  autoFocus: boolean;
  onChange: (next: OdState) => void;
}

const SORTED = [...ODS].sort((a, b) => a.date.localeCompare(b.date));

const shortcutBtn =
  "min-h-11 rounded-lg border-[1.5px] border-line bg-surface px-3 text-sm font-semibold hover:border-teal disabled:text-subtle disabled:hover:border-line";

export function odSummary(odState: OdState): { counted: number; hours: number; inPortal: number } {
  let counted = 0;
  let hours = 0;
  let inPortal = 0;
  for (const od of ODS) {
    const t = odState[od.id];
    if (t?.inPortal) inPortal++;
    if (!odCounted(t)) continue;
    counted++;
    hours += odTotalHours(od);
  }
  return { counted, hours, inPortal };
}

export function OdSection({ odState, autoFocus, onChange }: Props) {
  const summary = odSummary(odState);

  function set(id: string, patch: Partial<OdToggle>) {
    onChange({ ...odState, [id]: { ...odState[id], ...patch } });
  }

  function setAll(on: boolean) {
    onChange(Object.fromEntries(ODS.map((od) => [od.id, { ...odState[od.id], on }])));
  }

  const switchable = ODS.filter((od) => !odState[od.id].inPortal);
  const allOn = switchable.every((od) => odState[od.id].on);
  const allOff = switchable.every((od) => !odState[od.id].on);

  return (
    <section aria-labelledby="od-title">
      <h3
        id="od-title"
        tabIndex={-1}
        data-autofocus={autoFocus ? "" : undefined}
        className="scroll-mt-4 rounded text-sm font-bold"
      >
        On-duty leaves (OD)
      </h3>
      <p className="mt-0.5 text-xs text-subtle">Switch on the ODs you expect to be counted as present.</p>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button type="button" className={shortcutBtn} disabled={allOn} onClick={() => setAll(true)}>
          Count all
        </button>
        <button type="button" className={shortcutBtn} disabled={allOff} onClick={() => setAll(false)}>
          Count none
        </button>
      </div>

      <p className="mt-2 text-sm font-semibold" aria-live="polite">
        Counting {summary.counted} of {ODS.length} ODs ({summary.hours} of {OD_TOTAL_HOURS} hours)
        {summary.inPortal > 0 && (
          <span className="block text-xs font-normal text-subtle">
            {summary.inPortal} already {summary.inPortal === 1 ? "shows" : "show"} DL on the portal, so{" "}
            {summary.inPortal === 1 ? "it is" : "they are"} inside the baseline.
          </span>
        )}
      </p>

      <ul className="mt-2 flex flex-col gap-2">
        {SORTED.map((od) => {
          const t = odState[od.id];
          const total = odTotalHours(od);
          const titleId = `${od.id}-title`;
          return (
            <li key={od.id} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p id={titleId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-display text-sm font-bold">{formatDate(od.date)}</span>
                    {od.unconfirmed && (
                      <span className="state-skipped rounded-full border px-1.5 py-px text-[11px] font-bold">
                        Unconfirmed
                      </span>
                    )}
                    {t.inPortal && (
                      <span className="state-attended rounded-full border px-1.5 py-px text-[11px] font-bold">
                        In baseline
                      </span>
                    )}
                  </p>
                  <p className="text-sm">{od.reason}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={t.on}
                    aria-label="Count this OD as present"
                    aria-describedby={titleId}
                    disabled={t.inPortal}
                    onClick={() => set(od.id, { on: !t.on })}
                    className="group flex h-11 w-12 items-center justify-center rounded-lg disabled:opacity-45"
                  >
                    <span
                      className={`flex h-[26px] w-12 items-center rounded-full border-[1.5px] px-[2px] transition-colors ${
                        t.on ? "justify-end border-teal bg-teal" : "justify-start border-field bg-muted"
                      }`}
                    >
                      <span
                        className={`h-[19px] w-[19px] rounded-full ${t.on ? "bg-white" : "bg-field"}`}
                      />
                    </span>
                  </button>
                  <span className="text-xs font-semibold tabular-nums">{fmtHours(total)}</span>
                </div>
              </div>

              <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Hours per course">
                {(Object.entries(od.hours) as [CourseCode, number][]).map(([code, hours]) => (
                  <li key={code} className="rounded-full bg-empty px-2 py-0.5 text-xs font-medium">
                    {COURSE_NAME[code]} +{hours}
                  </li>
                ))}
              </ul>

              <label className="mt-1 flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={t.inPortal}
                  onChange={(e) => set(od.id, { inPortal: e.target.checked })}
                  className="h-5 w-5 shrink-0 accent-teal"
                />
                Already shows DL on the portal
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
