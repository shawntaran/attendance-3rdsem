import type { CoursePlan, Plan } from "@/lib/plan";
import { fmtHours, fmtPct } from "@/lib/view";
import { AlertCircleIcon, ChevronDownIcon } from "./icons";

function sorted(plan: Plan): CoursePlan[] {
  // Fewest skippable hours first; ties keep the course order.
  return [...plan.courses].sort((a, b) => a.skippableHours - b.skippableHours);
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-ok-border" : "bg-must-border"}`}
    />
  );
}

function FinalPct({ course, target }: { course: CoursePlan; target: number }) {
  const below = course.finalPctIfSkipGreens < target - 1e-9;
  return (
    <span className={`inline-flex items-center gap-1 ${below ? "font-bold text-must-border" : ""}`}>
      {fmtPct(course.finalPctIfSkipGreens)}
      {below && (
        <>
          <AlertCircleIcon size={14} />
          <span className="text-xs">below {target}%</span>
        </>
      )}
    </span>
  );
}

const TITLE = "Skip allowance per course";

export function CourseTable({ plan, isDesktop }: { plan: Plan; isDesktop: boolean }) {
  const rows = sorted(plan);

  if (!isDesktop) {
    return (
      <details className="group rounded-xl border border-line bg-white">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 [&::-webkit-details-marker]:hidden">
          <h2 className="font-display text-base font-bold">{TITLE}</h2>
          <ChevronDownIcon size={20} className="transition-transform group-open:rotate-180" />
        </summary>
        <ul className="border-t border-line">
          {rows.map((c) => (
            <li key={c.code} className="border-b border-line px-4 py-2.5 last:border-b-0">
              <div className="flex items-center gap-2">
                <Dot ok={c.finalPctIfSkipGreens >= plan.targetPct - 1e-9} />
                <span className="text-sm font-semibold">{c.name}</span>
                <span className="text-xs text-subtle">{c.code}</span>
              </div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div>
                  <dt className="text-subtle">Now</dt>
                  <dd className="text-sm font-semibold tabular-nums">{fmtPct(c.currentPct)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Skippable left</dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    {c.skippableHours} of {fmtHours(c.remainingHours)}
                  </dd>
                </div>
                <div>
                  <dt className="text-subtle">Skips used</dt>
                  <dd className="text-sm font-semibold tabular-nums">{fmtHours(c.skipHoursUsed)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Final if I skip all greens</dt>
                  <dd className="text-sm font-semibold tabular-nums">
                    <FinalPct course={c} target={plan.targetPct} />
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </details>
    );
  }

  return (
    <section aria-labelledby="courses-title" className="rounded-xl border border-line bg-white p-5">
      <h2 id="courses-title" className="font-display text-lg font-bold">
        {TITLE}
      </h2>
      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-subtle">
            <th scope="col" className="py-1.5 pr-3 font-semibold">Course</th>
            <th scope="col" className="px-3 py-1.5 text-right font-semibold">Now %</th>
            <th scope="col" className="px-3 py-1.5 text-right font-semibold">Skippable hrs left</th>
            <th scope="col" className="px-3 py-1.5 text-right font-semibold">Skips used</th>
            <th scope="col" className="py-1.5 pl-3 text-right font-semibold">Final % if I skip all greens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.code} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-2 pr-3 text-left font-normal">
                <span className="flex items-center gap-2">
                  <Dot ok={c.finalPctIfSkipGreens >= plan.targetPct - 1e-9} />
                  <span>
                    {c.name} <span className="text-subtle">{c.code}</span>
                  </span>
                </span>
              </th>
              <td className="px-3 py-2 text-right tabular-nums">{fmtPct(c.currentPct)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                <strong>{c.skippableHours}</strong> of {fmtHours(c.remainingHours)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtHours(c.skipHoursUsed)}</td>
              <td className="py-2 pl-3 text-right tabular-nums">
                <FinalPct course={c} target={plan.targetPct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
