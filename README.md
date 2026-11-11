# Skip Planner

A mobile-first web app for section 3CSE02 that answers one question for every class in the plan
window (11 Nov to 5 Dec 2026 by default): **can I skip this, or do I have to go?** The goal is to
finish every one of the 11 courses at 75% attendance or more on the last day of the window.

- One timetable per week. Each class is green ("Can skip") or red ("Attend").
- Tap a class to say "I attended this" or "I skipped this". The plan recalculates at once and a
  toast tells you what moved, with an Undo.
- A live table shows, per course: attendance now, skippable hours left, skips used, and the
  final % if you skip every green class.
- The window's last day ("Plan until") and extra working days, such as Sat 5 Dec running Monday's
  timetable, are settings. Week tabs, dates and labels follow them.
- A switch per OD (on-duty leave), because each one is granted or not on its own. Flip any
  combination and see the skip budget change at once.
- Cloud sync: the same marks and settings on every device, through a Supabase database behind
  this app's own API. No login: it is a single-user planner. It keeps working offline and syncs
  when the connection is back. See [Cloud sync](#cloud-sync).
- Light and dark themes. It follows the device by default; **Settings > Theme** forces one.
- Can be added to a phone home screen (web manifest and icons included).

## Run it

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # rules engine tests (Vitest)
npm run build   # production build, same command Vercel runs
```

To test another day, add `?today=YYYY-MM-DD` to the URL, for example
`http://localhost:3000/?today=2026-11-18`. Without it, "today" is the device's local date.

## The rules

The engine is in [`src/lib/plan.ts`](src/lib/plan.ts): pure functions, no React. The fixed data
(window, periods, timetable, courses, portal baseline, ODs) is in [`src/lib/config.ts`](src/lib/config.ts).

`computePlan({ settings, marks, today })` works on each course independently. Marks are
`Record<sessionId, 'attended' | 'skipped'>`, and a session id is `${date}@${startPeriod}`.
Labs and aptitude span 2 periods and count as 2 hours.

1. **Sessions.** Take every timetable session of the course in the window (`WINDOW_START`
   2026-11-11 to the `windowEnd` setting, default 2026-12-05), remove dates on or before
   `baselineAsOf` (those are already inside the baseline), and sort by date and period. Which
   timetable a date runs, in this order: a fixed no-class day (such as 2 to 4 Dec) or a holiday
   has none; an extra working day runs the weekday
   it follows (this also overrides a normal weekday); Monday to Friday run their own; weekends
   have none. See [Plan window](#plan-window-and-extra-working-days).
2. **Walk them.** Start with `P` = baseline present hours and `H` = baseline held hours (see
   [On-duty leaves](#on-duty-leaves-od) for how `P` is built from the portal figure). For each
   session the effective status is its mark; with no mark it is "attended (assumed)" if the date
   is before today, otherwise undecided.
   - attended: `P += span`, `H += span`
   - skipped: `H += span`
   - undecided: goes into the remaining list `R`
3. **Budget.** With `n` = total hours in `R` and `t` = target (0.75):

   ```
   budgetHours = clamp(floor(P - t*H + (1 - t)*n + 1e-9) - cushion, 0, n)
   ```

   Why: if you skip `x` more hours, final present is `P + n - x` and final held is `H + n`.
   Requiring `(P + n - x) / (H + n) >= t` gives `x <= P - t*H + (1 - t)*n`. The cushion
   (default 1 hour) is kept unspent as a safety margin.
4. **Latest-first allocation.** `g = min(|R|, floor(budgetHours / span))`. The **last** `g`
   sessions of `R` are green ("Can skip"). Every other session in `R` is red ("Attend"). Skips
   therefore pile up in the final weeks and spill backwards into earlier weeks only when a
   course's budget does not fit in the later ones.
5. **Per course output.** `P`, `H`, current %, the remaining sessions with their status,
   `budgetHours`, skip hours used, the final % if you attend everything left, and the final % if
   you skip every green.

What follows from that:

- Attending a green class removes it, and the freed skip moves to the nearest earlier red class
  of the same course.
- Attending a red class changes no greens.
- Skipping any class cuts that course's budget by the class's hours.
- A past day you never marked counts as attended. That can shrink a budget, because it can never
  be more than the hours that are left.

`diffPlans(before, after)` compares two plans and reports moved skips per course (for example
"Comp Org & Arch: skip moved from Fri 4 Dec to Wed 11 Nov"). `diffBudgets(before, after)` lists
the courses whose `budgetHours` changed. The toasts use both.

Dates are plain `YYYY-MM-DD` strings throughout. The code never calls `new Date("YYYY-MM-DD")`,
which would be read as UTC and can land on the wrong day.

## On-duty leaves (OD)

The app keeps two things apart:

- **Portal baseline.** Present and held hours per course exactly as the Linways portal shows
  them on `baselineAsOf` (DL counted as present, SUS excluded). An OD the portal has not approved
  yet is still an absence in these numbers. Defaults: `PORTAL_BASELINE` in
  [`src/lib/config.ts`](src/lib/config.ts), as of 2026-11-10.
- **ODs.** The 10 on-duty leaves in `ODS` (40 hours in total). Each lists, per course, the absent
  hours in the baseline that it would turn into present hours.

Each OD has two flags, saved as `odState[odId] = { on, inPortal }`:

| Flag | Meaning |
| --- | --- |
| `on` | Count this OD's hours as present. Default: on for all ten. |
| `inPortal` | "Already shows DL on the portal": the hours are already inside the baseline, so the OD adds nothing and its switch is disabled. This is what stops double counting. Default: off. |

The baseline the rules start from is then:

```
P(course) = portal present(course) + sum of od.hours[course] for every OD that is on and not inPortal
H(course) = portal held(course)        (unchanged: those hours are already held, as absences)
```

Everything after that (marks, past days, budget formula, latest-first allocation) is the same as
above. With all ten on you get the old "ODs granted" numbers, with none the old "ODs pending"
numbers.

In the app: the **ODs 10/10** button in the header (or **Settings**) opens the list. Each row has
the date, the reason, the hours per course, a switch, and the "Already shows DL on the portal"
box. "Count all" and "Count none" flip every switch. Each change shows a toast such as
"Linear Algebra skip budget 5 to 4, Web Tech Lab 2 to 0" with an Undo, and the allowance table
shows "includes +4 OD hrs" under a course's Now % when OD hours are counted in it.

## Plan window and extra working days

- **Start:** `WINDOW_START`, 2026-11-11, fixed in [`src/lib/config.ts`](src/lib/config.ts).
- **End:** the `windowEnd` setting, **Settings > Plan until**. Default 2026-12-05. The header
  ("till 5 Dec"), color key, allowance table and popover texts all use it.
- **Term end:** the academic year ends on Tue 1 Dec, so Wed 2 to Fri 4 Dec have no classes. They
  are fixed in `FIXED_MUTED_DAYS` in [`src/lib/config.ts`](src/lib/config.ts) (shown muted as
  "No classes: term ended 1 Dec") and win over an extra working day on the same date. Sat 5 Dec is
  the only teaching day after 1 Dec.
- **Extra working days:** `extraWorkingDays`, a list of `{ date, followsWeekday, reason }`, edited
  in **Settings > Extra working days**. The default is Sat 5 Dec following Monday's timetable
  (MAT2303 period 1, CSE2255 period 2, CSE2254 periods 3 to 4), the make-up for the Mon 9 Nov
  holiday. A day must be inside the window and not a Sunday. A holiday on the same date wins.
  A listed day that falls outside the window after "Plan until" moves is kept but ignored.

Weeks are built from the window, Monday-based, so tabs appear or disappear when "Plan until"
moves. A week shows Monday to Friday, plus a Saturday row only when that Saturday is an extra
working day; Sunday is never shown. Days in a shown week but outside the window are muted
"Outside plan". Session ids stay `${date}@${startPeriod}`, so marks keep working. The rules are
unchanged: a longer window just means more remaining hours, which raises some budgets.

## Cloud sync

### How it works

```
Browser (each device)                    Vercel (server)                Supabase
-----------------------------            ---------------------          ------------------
Planner UI                               /api/planner                   planner_state
  usePlannerSync -> SyncEngine   <---->    GET: state + version   <-->    one row: state jsonb,
  IndexedDB cache (this device)            PUT: state if version            version, updated_at
                                           still matches (else 409)
```

- **The cloud is the source of truth.** One row in `planner_state` holds the whole `AppState`
  (settings, ODs, baseline, plan window, marks) as JSON, plus a `version` number. The plan
  itself is still computed in the browser by `computePlan()`; only the inputs are stored.
- **The browser never talks to Supabase.** It calls `/api/planner` on this app. The route uses
  the service-role key, which exists only on the server. The table has Row Level Security on
  with no policies, so the public Supabase API cannot read or change it.
- **No silent overwrites.** Every save sends the version it was based on. The server updates the
  row only if the version still matches (one atomic `UPDATE ... WHERE version = n`) and sets
  the new version itself; otherwise it answers 409 with what it has now. A database trigger also
  refuses any update that does not move the version forward by exactly one.
- **Local first.** On launch the app shows this device's cached copy (IndexedDB) at once, then
  fetches the cloud copy and reconciles. Edits are cached immediately and sent after a 0.8 s
  pause. Changes from other devices are picked up every 15 s while the tab is visible, and at
  once when the tab comes back into view, the window gets focus or the network returns.
- **Merging, not last-write-wins.** When the cloud moved on while this device had unsent changes,
  the two are merged entry by entry: each attendance mark (by session id), each setting, each
  baseline course, each OD, each holiday and each extra working day. Different entries combine
  cleanly. Only the same entry changed differently on two devices is a conflict.
- **Offline.** The planner keeps working; edits stay in IndexedDB as pending and are retried
  (with backoff, and on reconnect). A failed save never drops them. When the page is closed with
  changes pending, one last save is attempted; whether or not it lands, the change is still in the
  cache and is reconciled on the next launch.

The status next to the week title shows **Cloud synced**, **Saving...**, **Sync pending**,
**Offline** or **Sync error** (tap it to retry; hover or long-press for the reason).

### Conflicts and recovery

- **Same entry changed on two devices:** the cloud value is used, everything else is merged, and a
  banner lists what clashed. **Use this device's values** puts this device's values back and
  saves them; **Keep the cloud copy** dismisses it.
- **This device has different data from the cloud on its first sync** (for example two phones
  both used the old local-only app): the cloud copy is shown and nothing is uploaded. The banner
  offers **Keep the cloud copy** or **Use this device's copy**.
- Both banners have **Download this device's copy**, which saves this device's version as a JSON
  file, so nothing is lost whichever you choose. The device's copy also stays in IndexedDB until
  you choose.
- If the server ever reports a stored state that does not validate, the app shows **Sync error**
  and never writes over it.

### First launch after the upgrade (migrating from localStorage)

1. The app reads the old `skip-planner:v3` (or v2/v1, migrated in memory with the existing
   migrations). It does not delete anything yet.
2. It asks the cloud. If there is **no record**, it uploads the local state, reads it back, and
   only when the copy in the cloud matches exactly does it remove the old localStorage keys.
3. If the cloud **already has the same state**, the old keys are removed. If it has a **different**
   state, both are kept and the conflict banner asks which to use (see above).
4. If the server cannot be reached or is not configured, the old keys stay and the app keeps
   working from this device's cache; the upload happens on a later launch or retry.

### Set up Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free tier is plenty).
2. **SQL Editor** > **New query**: paste the contents of
   [`supabase/migrations/0001_planner_state.sql`](supabase/migrations/0001_planner_state.sql)
   and **Run**. It creates the `planner_state` table, the single-row and version checks, and locks
   the table to the service role.
3. **Project Settings** > **API**: copy the **Project URL** and the **service_role** key (under
   "Project API keys"; it is secret).
4. Locally: copy `.env.example` to `.env.local` and fill in both values. `.env.local` is
   git-ignored.
5. On Vercel: **Project** > **Settings** > **Environment Variables**, add `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` for Production (and Preview if you use it), then redeploy.
   Never prefix them with `NEXT_PUBLIC_`.
6. Open the app. The status should turn to **Cloud synced**, and your existing data is uploaded as
   described above. Without the variables the API answers "not configured", the status shows
   **Sync error**, and the app keeps everything on the device.

You do not need to enable Realtime: sync works through the app's API.

### Limitations

- **The API has no login.** Anyone who knows the deployed URL can read and change the planner
  through `/api/planner` (the database itself is locked). Keep the URL private.
- Changes from another device appear within about 15 s while the tab is open, not instantly.
- Two tabs on the same device share one cache. If one tab is closed within a second of an edit
  while offline, that edit can be overwritten in the cache by the other tab (it is still sent if
  the closing tab's last save got out).
- Supabase pauses free projects after a week without activity; the app then shows **Sync error**
  until the project is resumed from the dashboard, and keeps working on the device meanwhile.

## Saved state and migrations

The state is validated everywhere it enters: on the server for every save, in the browser for
every server reply and for the IndexedDB cache. The pre-cloud app saved it in localStorage under
`skip-planner:v3`; older versions are migrated in memory on first launch:

- **v2** (OD switches, no window settings): everything is kept; `windowEnd` and
  `extraWorkingDays` get the defaults.
- **v1** (the old "ODs granted / pending" scenario): marks, target, cushion, holidays and theme are
  kept; the scenario becomes all ODs on or all off; the baseline is reset to the portal defaults;
  the window settings get the defaults.

Anything that fails validation is never used: a bad cache falls back to the cloud copy, a bad
server reply is reported as **Sync error**.

## Updating the baseline after a new attendance export

**In the app (quickest, this device only):**

1. Open **Settings** and scroll to **Portal attendance (ODs not included)**.
2. Set **Baseline as of** to the last date your export covers.
3. Type the **Present** and **Held** hours for each course exactly as the portal shows them.
4. For every OD the portal now shows as DL, tick **Already shows DL on the portal**. Its hours
   are in the numbers you just typed, so it must not be added again.
5. Classes on or before the new date are now inside the baseline, so the app ignores any marks
   on them. You do not need to clear them.

**In the code (the new defaults for every device):**

1. Edit `PORTAL_BASELINE` and `BASELINE_AS_OF` in [`src/lib/config.ts`](src/lib/config.ts). Remove
   an OD from `ODS` once the portal counts it for good, or add new ones.
2. `npm test` will now fail on the fixtures in `src/lib/plan.test.ts`, because they are written
   for the 10 Nov baseline and these ten ODs. Update or remove those expectations.
3. Commit and push. Vercel redeploys on its own.
4. A browser that already saved its own settings keeps them. Use **Settings > Reset everything**
   on that device to pick up the new defaults.

Holidays work the same way: add them in **Settings > Holidays**, or put them in
`DEFAULT_HOLIDAYS` in `config.ts`.

## Deploy on Vercel

The app is a standard Next.js project. Vercel detects the framework. For cloud sync it needs the
two environment variables from [Set up Supabase](#set-up-supabase); without them it still builds
and runs, keeping data on each device.

### With GitHub (recommended)

This folder is already a git repository with the work committed. If you are starting from a copy
without history, run the first three commands too.

```bash
git init
git add -A
git commit -m "Skip Planner"
```

Create an empty repository on GitHub (no README, no .gitignore), then push:

```bash
git remote add origin https://github.com/<your-username>/skip-planner.git
git branch -M main
git push -u origin main
```

Then on [vercel.com](https://vercel.com):

1. **Add New** > **Project**.
2. **Import** the `skip-planner` repository.
3. Leave everything as detected (Framework Preset: Next.js, Build Command: `next build`).
4. **Deploy**.

Every later `git push` to `main` redeploys.

### With the Vercel CLI

```bash
npm i -g vercel
vercel          # first run links the project and makes a preview deployment
vercel --prod   # production deployment
```

### Add it to your phone

Open the deployed URL on the phone, then:

- **Android (Chrome):** menu > **Add to Home screen** (or **Install app**).
- **iPhone (Safari):** Share > **Add to Home Screen**.

With Supabase set up, the phone and your laptop show the same planner.

## Project layout

```
src/lib/config.ts     window, periods, timetable, courses, portal baseline, ODs, default settings
src/lib/plan.ts       rules engine: computePlan, diffPlans, diffBudgets
src/lib/plan.test.ts  engine tests, including the fixture numbers
src/lib/dates.ts      YYYY-MM-DD helpers (no timezone traps)
src/lib/storage.ts    validation, legacy localStorage read, v1/v2 to v3 migration
src/lib/sync.ts       sync engine: reconcile (syncState), push, retry, conflicts
src/lib/merge.ts      three-way merge of two states, entry by entry
src/lib/remote.ts     client for /api/planner (loadRemoteState, saveRemoteState)
src/lib/localCache.ts IndexedDB cache (loadLocalCache, saveLocalCache)
src/lib/server/       API request handling and the Supabase repository (server only)
src/app/api/planner/  the GET / PUT route
supabase/migrations/  SQL for the planner_state table
src/lib/view.ts       labels and text shared by the views
src/components/       Planner, DesktopGrid, MobileDays, SessionDialog, SettingsDrawer, ...
src/app/              layout (fonts, metadata), page, manifest
scripts/generate-icons.mjs   redraws the icons in public/ (npm run icons)
```
