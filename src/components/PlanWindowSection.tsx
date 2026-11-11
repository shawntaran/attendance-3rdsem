"use client";

import { useEffect, useState } from "react";
import {
  FIXED_MUTED_DAYS,
  MAX_WINDOW_END,
  WEEKDAY_NAME,
  WINDOW_START,
  type ExtraWorkingDay,
  type Settings,
  type TimetableWeekday,
} from "@/lib/config";
import { formatDate, formatDayMonth, isValidDate, weekdayIndex } from "@/lib/dates";
import { MAX_REASON_LENGTH } from "@/lib/storage";
import { CloseIcon } from "./icons";

interface Props {
  settings: Settings;
  inputCls: string;
  onChange: (settings: Settings) => void;
}

const WEEKDAYS: TimetableWeekday[] = [1, 2, 3, 4, 5];

/** Why a new extra working day cannot be added, or null if it can. */
export function extraDayError(settings: Settings, date: string): string | null {
  if (!isValidDate(date)) return "Pick a date.";
  if (date < WINDOW_START || date > settings.windowEnd) {
    return `Pick a date inside the plan, ${formatDayMonth(WINDOW_START)} to ${formatDayMonth(settings.windowEnd)}.`;
  }
  if (weekdayIndex(date) === 0) return "Sundays are not supported.";
  if (settings.extraWorkingDays.some((x) => x.date === date)) return "This date is already listed.";
  return null;
}

/** Notes on a listed day that the plan does not use as entered. */
function rowNote(settings: Settings, day: ExtraWorkingDay): string | null {
  if (day.date < WINDOW_START || day.date > settings.windowEnd) return "Outside the plan, so it is ignored.";
  if (FIXED_MUTED_DAYS[day.date]) return `${FIXED_MUTED_DAYS[day.date]}. That wins, so no classes.`;
  if (settings.holidays.includes(day.date)) return "Also a holiday. The holiday wins, so no classes.";
  return null;
}

export function PlanWindowSection({ settings, inputCls, onChange }: Props) {
  const [endDraft, setEndDraft] = useState(settings.windowEnd);
  useEffect(() => setEndDraft(settings.windowEnd), [settings.windowEnd]);
  const endError =
    !isValidDate(endDraft) || endDraft < WINDOW_START || endDraft > MAX_WINDOW_END
      ? `Pick a date from ${formatDate(WINDOW_START)} to ${formatDate(MAX_WINDOW_END)}.`
      : null;

  const [date, setDate] = useState("");
  const [follows, setFollows] = useState<TimetableWeekday>(1);
  const [reason, setReason] = useState("");
  const addError = date === "" ? null : extraDayError(settings, date);

  function setDays(extraWorkingDays: ExtraWorkingDay[]) {
    onChange({ ...settings, extraWorkingDays: [...extraWorkingDays].sort((a, b) => a.date.localeCompare(b.date)) });
  }

  function updateDay(target: string, patch: Partial<ExtraWorkingDay>) {
    setDays(settings.extraWorkingDays.map((x) => (x.date === target ? { ...x, ...patch } : x)));
  }

  function add() {
    if (date === "" || extraDayError(settings, date)) return;
    setDays([...settings.extraWorkingDays, { date, followsWeekday: follows, reason: reason.trim() }]);
    setDate("");
    setReason("");
    setFollows(1);
  }

  return (
    <>
      <h3 className="mt-6 text-sm font-bold">Plan window</h3>
      <label className="mt-2 block text-sm font-semibold">
        Plan until
        <input
          type="date"
          min={WINDOW_START}
          max={MAX_WINDOW_END}
          value={endDraft}
          aria-invalid={!!endError}
          aria-describedby="plan-until-help"
          onChange={(e) => {
            const v = e.target.value;
            setEndDraft(v);
            if (isValidDate(v) && v >= WINDOW_START && v <= MAX_WINDOW_END) onChange({ ...settings, windowEnd: v });
          }}
          onBlur={() => setEndDraft(settings.windowEnd)}
          className={`${inputCls} mt-1 font-normal`}
        />
      </label>
      <p id="plan-until-help" className={`mt-1 text-xs ${endError ? "font-semibold text-must-border" : "text-subtle"}`}>
        {endError ?? `The plan runs from ${formatDate(WINDOW_START)} to ${formatDate(settings.windowEnd)}.`}
      </p>

      <h3 className="mt-6 text-sm font-bold">Extra working days</h3>
      <p className="mt-0.5 text-xs text-subtle">
        Days that run another weekday&rsquo;s timetable, such as a Saturday make-up day. A holiday on the
        same date wins.
      </p>

      {settings.extraWorkingDays.length > 0 && (
        <ul className="mt-2 flex flex-col gap-2">
          {settings.extraWorkingDays.map((day) => {
            const note = rowNote(settings, day);
            const label = formatDate(day.date);
            return (
              <li key={day.date} className="rounded-lg border border-line bg-surface p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-bold">{label}</span>
                  <button
                    type="button"
                    aria-label={`Remove extra working day ${label}`}
                    onClick={() => setDays(settings.extraWorkingDays.filter((x) => x.date !== day.date))}
                    className="-my-1.5 -mr-1.5 flex h-11 w-11 items-center justify-center rounded-lg hover:bg-empty"
                  >
                    <CloseIcon size={18} />
                  </button>
                </div>
                <div className="mt-1 grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-2">
                  <label className="text-xs font-semibold">
                    Follows
                    <select
                      value={day.followsWeekday}
                      onChange={(e) => updateDay(day.date, { followsWeekday: Number(e.target.value) as TimetableWeekday })}
                      className={`${inputCls} mt-0.5 font-normal`}
                    >
                      {WEEKDAYS.map((w) => (
                        <option key={w} value={w}>
                          {WEEKDAY_NAME[w]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs font-semibold">
                    Reason
                    <input
                      type="text"
                      value={day.reason}
                      maxLength={MAX_REASON_LENGTH}
                      onChange={(e) => updateDay(day.date, { reason: e.target.value })}
                      className={`${inputCls} mt-0.5 font-normal`}
                    />
                  </label>
                </div>
                {note && <p className="mt-1.5 text-xs font-semibold text-must-border">{note}</p>}
              </li>
            );
          })}
        </ul>
      )}

      <fieldset className="mt-2 rounded-lg border border-dashed border-field p-2.5">
        <legend className="px-1 text-xs font-semibold">Add a day</legend>
        <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-2">
          <label className="text-xs font-semibold">
            Date
            <input
              type="date"
              min={WINDOW_START}
              max={settings.windowEnd}
              value={date}
              aria-invalid={!!addError}
              aria-describedby={addError ? "extra-day-error" : undefined}
              onChange={(e) => setDate(e.target.value)}
              className={`${inputCls} mt-0.5 font-normal`}
            />
          </label>
          <label className="text-xs font-semibold">
            Follows
            <select
              value={follows}
              onChange={(e) => setFollows(Number(e.target.value) as TimetableWeekday)}
              className={`${inputCls} mt-0.5 font-normal`}
            >
              {WEEKDAYS.map((w) => (
                <option key={w} value={w}>
                  {WEEKDAY_NAME[w]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {addError && (
          <p id="extra-day-error" className="mt-1 text-xs font-semibold text-must-border">
            {addError}
          </p>
        )}
        <label className="mt-2 block text-xs font-semibold">
          Reason (optional)
          <input
            type="text"
            value={reason}
            maxLength={MAX_REASON_LENGTH}
            onChange={(e) => setReason(e.target.value)}
            className={`${inputCls} mt-0.5 font-normal`}
          />
        </label>
        <button
          type="button"
          onClick={add}
          disabled={date === "" || !!addError}
          className="mt-2 min-h-11 w-full rounded-lg bg-ink px-4 text-sm font-bold text-page disabled:bg-muted disabled:text-subtle"
        >
          Add extra working day
        </button>
      </fieldset>
    </>
  );
}
