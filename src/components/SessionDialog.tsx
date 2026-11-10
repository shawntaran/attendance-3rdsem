"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { COURSE_NAME } from "@/lib/config";
import { formatDate } from "@/lib/dates";
import type { Mark, Plan, PlanSession } from "@/lib/plan";
import { STATUS_LABEL, fmtHours, reasonText, skipWarning, timeRange } from "@/lib/view";
import { AlertCircleIcon, CloseIcon, StatusIcon } from "./icons";
import { useModal } from "./useModal";

interface Props {
  plan: Plan;
  session: PlanSession;
  /** The cell that opened the dialog; the desktop popover is placed next to it. */
  anchor: HTMLElement | null;
  isDesktop: boolean;
  onMark: (mark: Mark | null) => void;
  onClose: () => void;
}

const POPOVER_WIDTH = 348;
const MARGIN = 10;

const primaryBtn =
  "min-h-11 w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-dark";
const secondaryBtn =
  "min-h-11 w-full rounded-lg border-[1.5px] border-ink bg-white px-4 py-2.5 text-sm font-bold text-ink hover:bg-empty";

export function SessionDialog({ plan, session, anchor, isDesktop, onMark, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useModal(ref, onClose);

  useLayoutEffect(() => {
    if (!isDesktop) return;
    function place() {
      const el = ref.current;
      if (!el) return;
      const height = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const a = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
      if (!a) {
        setPos({ top: Math.max(MARGIN, (vh - height) / 2), left: (vw - POPOVER_WIDTH) / 2 });
        return;
      }
      let top = a.bottom + 8;
      if (top + height > vh - MARGIN) top = a.top - height - 8; // flip above
      top = Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - height - MARGIN));
      let left = a.left + a.width / 2 - POPOVER_WIDTH / 2;
      left = Math.min(Math.max(left, MARGIN), vw - POPOVER_WIDTH - MARGIN);
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, isDesktop, session.id, session.status]);

  const name = COURSE_NAME[session.course];
  const status = session.status;
  const undecided = status === "skip-ok" || status === "attend";
  const warning = status === "attend" ? skipWarning(plan, session) : null;

  const body = (
    <>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="session-title" className="font-display text-lg leading-tight font-bold">
            {name}
          </h2>
          <p className="text-sm text-subtle">{session.course}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1.5 -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink hover:bg-empty"
        >
          <CloseIcon size={20} />
        </button>
      </div>

      <p className="mt-1 text-sm font-medium">
        {formatDate(session.date)} · {timeRange(session)} · {fmtHours(session.span)}
      </p>

      <p
        className={`state-${status} mt-3 inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-1 text-xs font-bold`}
      >
        <StatusIcon status={status} size={14} />
        {STATUS_LABEL[status]}
        {status === "assumed" && <span className="font-medium">(Assumed)</span>}
      </p>

      <p className="mt-2.5 text-sm leading-relaxed">{reasonText(plan, session)}</p>

      <div className="mt-4 flex flex-col gap-2">
        {undecided && (
          <>
            <button type="button" data-autofocus className={primaryBtn} onClick={() => onMark("attended")}>
              I attended this
            </button>
            <button
              type="button"
              className={secondaryBtn}
              onClick={() => onMark("skipped")}
              aria-describedby={warning ? "skip-warning" : undefined}
            >
              I skipped this
            </button>
            {warning && (
              <p
                id="skip-warning"
                className="flex gap-2 rounded-lg border-[1.5px] border-must-border bg-[#fdecea] px-3 py-2 text-xs leading-relaxed font-medium text-must-ink"
              >
                <AlertCircleIcon size={16} className="mt-0.5 shrink-0" />
                <span>{warning.text}</span>
              </p>
            )}
          </>
        )}
        {status === "assumed" && (
          <>
            <button type="button" data-autofocus className={primaryBtn} onClick={() => onMark("skipped")}>
              I skipped this
            </button>
            <button type="button" className={secondaryBtn} onClick={() => onMark("attended")}>
              I attended this
            </button>
          </>
        )}
        {(status === "attended" || status === "skipped") && (
          <button type="button" data-autofocus className={primaryBtn} onClick={() => onMark(null)}>
            Undo
          </button>
        )}
      </div>
    </>
  );

  if (isDesktop) {
    return (
      <div className="fixed inset-0 z-40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-title"
          tabIndex={-1}
          className="anim-fade fixed rounded-xl border border-line bg-white p-4 shadow-[0_12px_40px_rgb(20_32_43/0.28)]"
          style={{
            width: POPOVER_WIDTH,
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            visibility: pos ? "visible" : "hidden",
          }}
        >
          {body}
        </div>
      </div>
    );
  }

  return (
    <div
      className="anim-fade fixed inset-0 z-40 flex items-end bg-ink/50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-title"
        tabIndex={-1}
        className="anim-sheet max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl bg-white px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        {body}
      </div>
    </div>
  );
}
