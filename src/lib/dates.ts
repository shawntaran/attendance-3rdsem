// Dates are plain "YYYY-MM-DD" strings everywhere in this app.
// Never parse them with `new Date("YYYY-MM-DD")`: that is read as UTC midnight
// and shifts by a day in some timezones. All maths here goes through Date.UTC
// with explicit parts, so it is timezone independent.

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function parts(date: string): [number, number, number] {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Bad date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toUtc(date: string): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  return fromUtc(toUtc(value)) === value;
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayIndex(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}

export function weekdayName(date: string): string {
  return WEEKDAYS[weekdayIndex(date)];
}

/** "1 Dec" */
export function formatDayMonth(date: string): string {
  const [, m, d] = parts(date);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "Tue 1 Dec" */
export function formatDate(date: string): string {
  return `${weekdayName(date)} ${formatDayMonth(date)}`;
}

export function yearOf(date: string): number {
  return parts(date)[0];
}

/** Every date from start to end inclusive. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The device's local calendar date. */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
