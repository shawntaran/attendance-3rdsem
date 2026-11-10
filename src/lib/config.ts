// All the fixed data for the planner: window, periods, timetable, courses and
// the baseline attendance. To update after re-exporting attendance, edit
// BASELINES and BASELINE_AS_OF below (or use the Settings drawer in the app).

export type CourseCode =
  | "CSE2251"
  | "CSE2252"
  | "APT4002"
  | "CSE2259"
  | "CSE2257"
  | "CSE2253"
  | "MAT2303"
  | "CSE2255"
  | "CSE2258"
  | "CSE2256"
  | "CSE2254";

export interface Course {
  code: CourseCode;
  name: string;
}

export const COURSES: Course[] = [
  { code: "CSE2251", name: "Data Comm & Networks" },
  { code: "CSE2252", name: "DCCN Lab" },
  { code: "APT4002", name: "Aptitude" },
  { code: "CSE2259", name: "Web Tech Lab" },
  { code: "CSE2257", name: "Comp Org & Arch" },
  { code: "CSE2253", name: "Data Structures" },
  { code: "MAT2303", name: "Linear Algebra" },
  { code: "CSE2255", name: "OOP Java" },
  { code: "CSE2258", name: "Web Tech" },
  { code: "CSE2256", name: "OOP Java Lab" },
  { code: "CSE2254", name: "DS Lab" },
];

export const COURSE_CODES: CourseCode[] = COURSES.map((c) => c.code);

export const COURSE_NAME: Record<CourseCode, string> = Object.fromEntries(
  COURSES.map((c) => [c.code, c.name]),
) as Record<CourseCode, string>;

export const SECTION = "3CSE02";

// ---- Window and weeks ------------------------------------------------------

export const WINDOW_START = "2026-11-11";
export const WINDOW_END = "2026-12-01";

export interface Week {
  id: number;
  label: string;
  /** Monday of the week; the grid always renders Mon to Fri. */
  monday: string;
  /** First and last date of the week that fall inside the window. */
  from: string;
  to: string;
}

export const WEEKS: Week[] = [
  { id: 1, label: "Week 1", monday: "2026-11-09", from: "2026-11-11", to: "2026-11-13" },
  { id: 2, label: "Week 2", monday: "2026-11-16", from: "2026-11-16", to: "2026-11-20" },
  { id: 3, label: "Week 3", monday: "2026-11-23", from: "2026-11-23", to: "2026-11-27" },
  { id: 4, label: "Week 4", monday: "2026-11-30", from: "2026-11-30", to: "2026-12-01" },
];

/** Days rendered in the grid but with no classes, and the note shown on them. */
export const FIXED_MUTED_DAYS: Record<string, string> = {
  "2026-11-09": "Non-instructional day",
  "2026-11-10": "Deepavali holiday",
  "2026-12-02": "After 1 Dec",
  "2026-12-03": "After 1 Dec",
  "2026-12-04": "After 1 Dec",
};

/** Extra holidays inside the window. Sessions on these dates are removed. */
export const DEFAULT_HOLIDAYS: string[] = [];

// ---- Periods ---------------------------------------------------------------

export interface Period {
  n: number;
  start: string;
  end: string;
}

/** Period 5 is the lunch break and has no classes. */
export const PERIODS: Period[] = [
  { n: 1, start: "08:50", end: "09:45" },
  { n: 2, start: "09:45", end: "10:40" },
  { n: 3, start: "10:50", end: "11:45" },
  { n: 4, start: "11:45", end: "12:35" },
  { n: 6, start: "13:25", end: "14:20" },
  { n: 7, start: "14:30", end: "15:25" },
  { n: 8, start: "15:25", end: "16:15" },
];

export const PERIOD_BY_N: Record<number, Period> = Object.fromEntries(
  PERIODS.map((p) => [p.n, p]),
);

/** Start of the first period and end of the last one a class covers. */
export function sessionTimes(startPeriod: number, span: number): { start: string; end: string } {
  const first = PERIOD_BY_N[startPeriod];
  const last = PERIOD_BY_N[startPeriod + span - 1];
  return { start: first.start, end: last.end };
}

// ---- Timetable -------------------------------------------------------------

export interface Slot {
  startPeriod: number;
  /** Number of periods; also the number of attendance hours. */
  span: number;
  course: CourseCode;
}

/** Keyed by weekday index: 1 = Monday ... 5 = Friday. */
export const TIMETABLE: Record<number, Slot[]> = {
  1: [
    { startPeriod: 1, span: 1, course: "MAT2303" },
    { startPeriod: 2, span: 1, course: "CSE2255" },
    { startPeriod: 3, span: 2, course: "CSE2254" },
  ],
  2: [
    { startPeriod: 1, span: 1, course: "CSE2257" },
    { startPeriod: 2, span: 1, course: "CSE2255" },
    { startPeriod: 3, span: 2, course: "CSE2252" },
    { startPeriod: 6, span: 1, course: "CSE2251" },
    { startPeriod: 7, span: 1, course: "CSE2258" },
    { startPeriod: 8, span: 1, course: "CSE2253" },
  ],
  3: [
    { startPeriod: 1, span: 2, course: "APT4002" },
    { startPeriod: 3, span: 1, course: "CSE2257" },
    { startPeriod: 4, span: 1, course: "CSE2255" },
    { startPeriod: 6, span: 1, course: "MAT2303" },
  ],
  4: [
    { startPeriod: 1, span: 1, course: "MAT2303" },
    { startPeriod: 2, span: 1, course: "CSE2253" },
    { startPeriod: 3, span: 1, course: "CSE2251" },
    { startPeriod: 4, span: 1, course: "CSE2258" },
    { startPeriod: 7, span: 2, course: "CSE2256" },
  ],
  5: [
    { startPeriod: 1, span: 1, course: "CSE2257" },
    { startPeriod: 2, span: 1, course: "CSE2251" },
    { startPeriod: 3, span: 2, course: "CSE2259" },
    { startPeriod: 6, span: 1, course: "CSE2253" },
    { startPeriod: 7, span: 1, course: "CSE2258" },
    { startPeriod: 8, span: 1, course: "MAT2303" },
  ],
};

// ---- Baseline attendance ---------------------------------------------------

/** [present hours, held hours]. DL counted present, SUS excluded. */
export type Baseline = Record<CourseCode, [number, number]>;

export type Scenario = "odsGranted" | "odsPending";

export const SCENARIO_LABEL: Record<Scenario, string> = {
  odsGranted: "ODs granted",
  odsPending: "ODs pending",
};

export const BASELINE_AS_OF = "2026-11-10";

export const BASELINES: Record<Scenario, Baseline> = {
  odsGranted: {
    CSE2251: [33, 34],
    CSE2252: [21, 22],
    APT4002: [20, 20],
    CSE2259: [18, 22],
    CSE2257: [34, 36],
    CSE2253: [29, 33],
    MAT2303: [32, 38],
    CSE2255: [26, 29],
    CSE2258: [31, 34],
    CSE2256: [24, 24],
    CSE2254: [20, 20],
  },
  odsPending: {
    CSE2251: [29, 34],
    CSE2252: [19, 22],
    APT4002: [14, 20],
    CSE2259: [16, 22],
    CSE2257: [30, 36],
    CSE2253: [25, 33],
    MAT2303: [26, 38],
    CSE2255: [24, 29],
    CSE2258: [27, 34],
    CSE2256: [19, 24],
    CSE2254: [20, 20],
  },
};

// ---- Settings --------------------------------------------------------------

export type Theme = "system" | "light" | "dark";

export const THEME_LABEL: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export interface Settings {
  /** "system" follows the device's light or dark setting. */
  theme: Theme;
  scenario: Scenario;
  /** Target attendance in percent, e.g. 75. */
  targetPct: number;
  /** Safety margin in hours kept unspent in every course. */
  cushionHours: number;
  /** Sessions on or before this date are already inside the baseline. */
  baselineAsOf: string;
  baselines: Record<Scenario, Baseline>;
  holidays: string[];
}

export const DEFAULT_TARGET_PCT = 75;
export const DEFAULT_CUSHION_HOURS = 1;

export function defaultSettings(): Settings {
  return {
    theme: "system",
    scenario: "odsGranted",
    targetPct: DEFAULT_TARGET_PCT,
    cushionHours: DEFAULT_CUSHION_HOURS,
    baselineAsOf: BASELINE_AS_OF,
    baselines: structuredClone(BASELINES),
    holidays: [...DEFAULT_HOLIDAYS],
  };
}
