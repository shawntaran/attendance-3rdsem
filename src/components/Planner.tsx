"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COURSE_NAME, ODS, SECTION, type OdState, type Settings, type Week } from "@/lib/config";
import { formatDate, isValidDate, localToday } from "@/lib/dates";
import {
  computePlan,
  diffBudgets,
  diffPlans,
  type BudgetChange,
  type Mark,
  type Marks,
  type PlanDiff,
  type PlanSession,
} from "@/lib/plan";
import { defaultState, loadState, saveState, type AppState } from "@/lib/storage";
import { endLabel, fmtHours, weekDays, weekRangeLabel } from "@/lib/view";
import { ColorKey } from "./ColorKey";
import { CourseTable } from "./CourseTable";
import { DesktopGrid } from "./DesktopGrid";
import { Glance } from "./Glance";
import { MobileDays } from "./MobileDays";
import { odSummary } from "./OdSection";
import { SessionDialog } from "./SessionDialog";
import { SettingsDrawer } from "./SettingsDrawer";
import { Toast, type ToastData } from "./Toast";
import { WeekTabs } from "./WeekTabs";
import { SettingsIcon } from "./icons";

const DESKTOP_QUERY = "(min-width: 900px)";
const TOAST_MS = 8000;
const PULSE_MS = 1600;

function initialWeek(weeks: Week[], today: string): number {
  const i = weeks.findIndex((w) => today <= w.to);
  return i === -1 ? Math.max(0, weeks.length - 1) : i;
}

function idDate(id: string): string {
  return formatDate(id.slice(0, id.indexOf("@")));
}

function toastMessage(lead: string, diff: PlanDiff, fallback: string): string {
  if (diff.moves.length > 0) {
    const moves = diff.moves.map((m) => `${m.courseName}, ${idDate(m.from)} to ${idDate(m.to)}`);
    return `${lead} Skip moved: ${moves.join("; ")}.`;
  }
  if (diff.lost.length > 0) return `${lead} ${diff.lost.map((l) => l.message).join("; ")}.`;
  if (diff.gained.length > 0) return `${lead} ${diff.gained.map((g) => g.message).join("; ")}.`;
  return `${lead} ${fallback}`;
}

const MAX_BUDGETS_IN_TOAST = 4;

/** "Linear Algebra skip budget 5 to 4, Web Tech Lab 2 to 0." */
function budgetMessage(changes: BudgetChange[]): string {
  if (changes.length === 0) return "No skip budgets change.";
  const shown = changes
    .slice(0, MAX_BUDGETS_IN_TOAST)
    .map((c, i) => `${c.courseName}${i === 0 ? " skip budget" : ""} ${c.before} to ${c.after}`);
  const more = changes.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}.`;
}

export function Planner() {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AppState>(defaultState);
  const [today, setToday] = useState("2026-11-11");
  const [isDesktop, setIsDesktop] = useState(false);
  const [weekIndex, setWeekIndex] = useState(0);
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement | null } | null>(null);
  // Which part of the settings drawer to open at, or null when it is closed.
  const [settingsOpen, setSettingsOpen] = useState<"top" | "ods" | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [pulse, setPulse] = useState<{ key: number; ids: Set<string> }>({ key: 0, ids: new Set() });

  const undoState = useRef<AppState | null>(null);
  const counter = useRef(0);
  const settingsOpener = useRef<HTMLElement | null>(null);

  // Everything that depends on the device (storage, date, width) is read after
  // mount, so the server-rendered HTML never disagrees with the client.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("today");
    const now = isValidDate(param) ? param : localToday();
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mq.matches);
    const loaded = loadState();
    setState(loaded);
    setToday(now);
    setWeekIndex(initialWeek(computePlan({ ...loaded, today: now }).weeks, now));
    setIsDesktop(mq.matches);
    setReady(true);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (ready) saveState(state);
  }, [ready, state]);

  // "system" leaves the attribute off, so the CSS media query decides.
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    if (state.settings.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = state.settings.theme;
  }, [ready, state.settings.theme]);

  const plan = useMemo(
    () => computePlan({ settings: state.settings, marks: state.marks, today }),
    [state, today],
  );

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (pulse.ids.size === 0) return;
    const id = window.setTimeout(() => setPulse((p) => ({ key: p.key, ids: new Set() })), PULSE_MS);
    return () => window.clearTimeout(id);
  }, [pulse]);

  const focusCell = useCallback((id: string) => {
    // The cell may have been re-created by the update, so look it up again.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-session-id="${id}"]`)?.focus();
    });
  }, []);

  /** Swap in a new state, pulse the cells that changed, and announce it. */
  function commit(next: AppState, message: string, changedIds: string[], canUndo: boolean) {
    undoState.current = canUndo ? state : null;
    counter.current += 1;
    setState(next);
    setPulse({ key: counter.current, ids: new Set(changedIds) });
    setToast({ key: counter.current, message, canUndo });
  }

  function commitMarks(nextMarks: Marks, lead: string, fallback: string) {
    const after = computePlan({ settings: state.settings, marks: nextMarks, today });
    const diff = diffPlans(plan, after);
    commit({ ...state, marks: nextMarks }, toastMessage(lead, diff, fallback), diff.changedIds, true);
  }

  /** An OD switch or its "already DL" box changed: recompute and report budgets. */
  function handleOdChange(odState: OdState) {
    const next: AppState = { ...state, settings: { ...state.settings, odState } };
    const after = computePlan({ settings: next.settings, marks: next.marks, today });
    commit(next, budgetMessage(diffBudgets(plan, after)), diffPlans(plan, after).changedIds, true);
  }

  function handleMark(mark: Mark | null) {
    if (!open) return;
    const session = plan.byId[open.id];
    const id = open.id;
    setOpen(null);
    focusCell(id);
    if (!session) return;

    const nextMarks = { ...state.marks };
    if (mark) nextMarks[id] = mark;
    else delete nextMarks[id];

    const name = COURSE_NAME[session.course];
    if (mark === "attended") {
      commitMarks(nextMarks, "Marked attended.", "Nothing else changes.");
    } else if (mark === "skipped") {
      const after = computePlan({ settings: state.settings, marks: nextMarks, today });
      const left = after.byCourse[session.course].skippableHours;
      commitMarks(nextMarks, "Marked skipped.", `${name} has ${fmtHours(left)} of skips left.`);
    } else {
      commitMarks(nextMarks, "Mark removed.", "Nothing else changes.");
    }
  }

  function handleUndo() {
    const previous = undoState.current;
    if (!previous) return;
    const after = computePlan({ settings: previous.settings, marks: previous.marks, today });
    commit(previous, "Undone.", diffPlans(plan, after).changedIds, false);
  }

  function closeDialog() {
    if (!open) return;
    const id = open.id;
    setOpen(null);
    focusCell(id);
  }

  function openSettings(at: "top" | "ods", opener: HTMLElement) {
    settingsOpener.current = opener;
    setSettingsOpen(at);
  }

  function closeSettings() {
    setSettingsOpen(null);
    requestAnimationFrame(() => settingsOpener.current?.focus());
  }

  function changeSettings(settings: Settings) {
    undoState.current = null;
    setToast(null);
    setState({ ...state, settings });
  }

  // "Plan until" can remove weeks, so keep the selected tab in range.
  const weeks = plan.weeks;
  const safeIndex = Math.min(weekIndex, Math.max(0, weeks.length - 1));
  // Never empty: windowEnd is at least WINDOW_START (a Wednesday), so week 1 always exists.
  const week = weeks[safeIndex];
  const end = endLabel(state.settings.windowEnd);
  const days = useMemo(() => weekDays(week, state.settings, plan), [week, state.settings, plan]);
  const openSession: PlanSession | undefined = open ? plan.byId[open.id] : undefined;
  const od = odSummary(state.settings.odState);
  const onOpen = (session: PlanSession, trigger: HTMLElement) => setOpen({ id: session.id, anchor: trigger });

  return (
    <div className="mx-auto max-w-[1240px] px-3 pt-4 pb-28 desk:px-8 desk:pt-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl leading-none font-bold desk:text-5xl">{week.label}</h1>
          <p className="mt-1.5 text-sm text-subtle desk:text-base">{weekRangeLabel(week)}</p>
        </div>
        <div className="flex items-start gap-2 desk:gap-3">
          <div className="hidden text-right text-sm text-subtle desk:block">
            <p>{SECTION} skip planner</p>
            <p>
              Keep every course at {state.settings.targetPct}% or more till {end}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => openSettings("ods", e.currentTarget)}
            aria-haspopup="dialog"
            aria-label={`On-duty leaves: ${od.counted} of ${ODS.length} counted as present. Open OD settings.`}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border-[1.5px] border-line bg-surface px-3 text-sm font-semibold whitespace-nowrap hover:border-teal"
          >
            ODs
            <span className="rounded-full bg-ok-bg px-1.5 py-px text-xs font-bold text-ok-ink tabular-nums">
              {od.counted}/{ODS.length}
            </span>
          </button>
          <button
            type="button"
            onClick={(e) => openSettings("top", e.currentTarget)}
            aria-haspopup="dialog"
            aria-label="Settings"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border-[1.5px] border-line bg-surface px-3 text-sm font-semibold hover:border-teal"
          >
            <SettingsIcon size={18} />
            <span className="hidden desk:inline">Settings</span>
          </button>
        </div>
      </header>
      <p className="mt-1 text-xs text-subtle desk:hidden">
        {SECTION} · keep every course at {state.settings.targetPct}% till {end}
      </p>

      <div className="sticky top-0 z-20 -mx-3 mt-3 bg-page px-3 py-2 desk:static desk:mx-0 desk:mt-5 desk:p-0">
        <WeekTabs weeks={weeks} selected={safeIndex} greenHoursByWeek={plan.greenHoursByWeek} onSelect={setWeekIndex} />
      </div>

      {!ready ? (
        <div className="mt-4 h-96 rounded-xl bg-muted" role="status" aria-label="Loading your plan" />
      ) : (
        <>
          <div
            id="week-panel"
            role="tabpanel"
            aria-labelledby={`week-tab-${week.id}`}
            className="mt-2 desk:mt-4"
          >
            {isDesktop ? (
              <DesktopGrid days={days} today={today} pulseIds={pulse.ids} pulseKey={pulse.key} onOpen={onOpen} />
            ) : (
              <MobileDays days={days} today={today} pulseIds={pulse.ids} pulseKey={pulse.key} onOpen={onOpen} />
            )}
          </div>

          <div className="mt-4 desk:mt-5">
            <Glance
              weeks={weeks}
              greenHoursByWeek={plan.greenHoursByWeek}
              total={plan.totalGreenHours}
              selected={safeIndex}
            />
          </div>

          <div className="mt-4 grid gap-4 desk:mt-5 desk:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] desk:items-start">
            <div className="order-2 desk:order-1">
              <ColorKey settings={state.settings} />
            </div>
            <div className="order-1 desk:order-2">
              <CourseTable plan={plan} isDesktop={isDesktop} />
            </div>
          </div>
        </>
      )}

      {open && openSession && (
        <SessionDialog
          plan={plan}
          session={openSession}
          anchor={open.anchor}
          isDesktop={isDesktop}
          onMark={handleMark}
          onClose={closeDialog}
        />
      )}

      {settingsOpen && (
        <SettingsDrawer
          settings={state.settings}
          markCount={Object.keys(state.marks).length}
          focusOds={settingsOpen === "ods"}
          onChange={changeSettings}
          onOdChange={handleOdChange}
          onResetMarks={() => {
            undoState.current = null;
            setToast(null);
            setState({ ...state, marks: {} });
          }}
          onResetAll={() => {
            undoState.current = null;
            setToast(null);
            setState(defaultState());
          }}
          onClose={closeSettings}
        />
      )}

      <Toast toast={toast} onUndo={handleUndo} onDismiss={() => setToast(null)} />
    </div>
  );
}
