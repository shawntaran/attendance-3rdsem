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
- Cloud sync: the same marks and settings on every device, through an Appwrite database behind
  this app's own API. No accounts: it is a single-user planner, locked with one private access
  key that each of your devices enters once. It keeps working offline and syncs
  when the connection is back. See [Cloud sync](#cloud-sync).
- What-if holidays: the switch on each day's title turns that day off and recalculates at once
  as if it were a holiday. A panel shows, for each course that loses classes, the final % (if you
  attend everything, and if you skip every green) and the skip budget, before and after. It is a
  preview on this device only: your real holidays and marks are unchanged and nothing is synced.
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
   session the effective status is its mark. Nothing is ever assumed about a class you have not
   marked.
   - attended: `P += span`, `H += span`
   - skipped: `H += span`
   - no mark, date before today: **unmarked**. Not added to `P` or `H` (so your current % only
     counts what you have marked); its hours go into `u`.
   - no mark, today or later: undecided, goes into the remaining list `R`
3. **Budget.** With `n` = total hours in `R`, `u` = unmarked hours and `t` = target (0.75):

   ```
   budgetHours = clamp(floor(P - t*H + (1 - t)*n - t*u + 1e-9) - cushion, 0, n)
   ```

   Why: unmarked classes are planned for as if you missed them, so a skip is never offered that
   only works if you actually attended them. If you skip `x` more hours, final present is
   `P + n - x` and final held is `H + n + u`. Requiring `(P + n - x) / (H + n + u) >= t` gives
   `x <= P - t*H + (1 - t)*n - t*u`. The cushion (default 1 hour) is kept unspent as a safety
   margin. The final % figures use the same worst case for unmarked classes.
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
- A past class you have not marked shows as **Not marked** until you set it. Marking it attended
  raises that course's budget by its hours; marking it skipped changes nothing, because it was
  already planned for as missed. A notice above the week tabs counts the unmarked classes and
  jumps to the first one.

`diffPlans(before, after)` compares two plans and reports moved skips per course (for example
"Comp Org & Arch: skip moved from Fri 4 Dec to Wed 11 Nov"). `diffBudgets(before, after)` lists
the courses whose `budgetHours` changed. The toasts use both.

Dates are plain `YYYY-MM-DD` strings throughout. The code never calls `new Date("YYYY-MM-DD")`,
which would be read as UTC and can land on the wrong day.

## On-duty leaves (OD)

The app keeps two things apart:

- **Baseline.** Present and held hours per course up to `baselineAsOf` (10 Nov), worked out class
  by class from the past record (see [Past record](#past-record)). DL counts as present;
  suspended hours count as held but not attended. An OD still pending is an absence in these
  numbers. Defaults: `PORTAL_BASELINE` in [`src/lib/config.ts`](src/lib/config.ts).
- **ODs.** The on-duty leaves in `ODS` that are not yet DL. There are two kinds:
  - **Baseline ODs**, before 10 Nov. Each lists, per course, the absent hours in the baseline that
    it would turn into present hours. Only one is left: **29 Sep, French event** (DCCN Lab +1);
    both lab hours that day are still absent in the record. The other ten (12 Aug, 4 Sep, 15, 16,
    17 and 24 Sep, 27, 29 and 30 Oct) are DLs in the record now, so they were removed.
  - **Plan ODs**, with `dates` inside the plan window. While switched on, every class on those days
    counts as present (attended and held) and shows as **On duty**, whatever is marked there;
    switching the OD off brings the marks back. Their hours come from the timetable. Currently one:
    the **STEM for Impact Hackathon**, Tue 17 and Wed 18 Nov (12 hours).

  A saved state from before an OD was added simply gets that OD switched on; nothing else in it
  changes.

Each OD has two flags, saved as `odState[odId] = { on, inPortal }`:

| Flag | Meaning |
| --- | --- |
| `on` | Count this OD's hours as present. Default: on for every OD. |
| `inPortal` | "Already shows DL on the portal": the hours are already inside the baseline, so the OD adds nothing and its switch is disabled. This is what stops double counting. Default: off. Baseline ODs only; a plan OD's days drop out of the plan by themselves once `baselineAsOf` moves past them. |

The baseline the rules start from is then:

```
P(course) = portal present(course) + sum of od.hours[course] for every OD that is on and not inPortal
H(course) = portal held(course)        (unchanged: those hours are already held, as absences)
```

Everything after that (marks, past days, budget formula, latest-first allocation) is the same as
above. With all ten baseline ODs on you get the old "ODs granted" numbers, with none the old
"ODs pending" numbers.

In the app: the **ODs 11/11** button in the header (or **Settings**) opens the list. Each row has
the date, the reason, the hours per course, a switch, and the "Already shows DL on the portal"
box. "Count all" and "Count none" flip every switch. Each change shows a toast such as
"Linear Algebra skip budget 5 to 4, Web Tech Lab 2 to 0" with an Undo, and the allowance table
shows "includes +4 OD hrs" under a course's Now % when OD hours are counted in it.

## Past record

**Plan / Past record** next to the week tabs switches to every past week laid out as the timetable
it ran, with each class marked **Present**, **Absent**, **OD (DL)** or **Suspended**, holidays named,
and a table of totals per course. It is read-only.

The data is the portal's Daily Attendance report, 5 Aug to 19 Nov 2026
([`src/lib/historyData.ts`](src/lib/historyData.ts)): one status per hour, with no course names.
[`src/lib/history.ts`](src/lib/history.ts) places each hour on its course:

- **Until 16 Sep:** the old timetable (`OLD_TIMETABLE`). It differs from the current one on
  Monday (OOP Java hour 1, Linear Algebra hour 2), Thursday (Comp Org in hour 6) and Friday
  (Web Tech hour 1, Linear Algebra hour 7, no hour 8).
- **From 17 Sep:** the current timetable.
- **Wed 9 Sep** ran Friday's timetable, as the portal's week-wise report for 7 to 13 Sep shows;
  Fri 11 Sep was a normal Friday in that report.

Every class day fits its timetable hour for hour; the only gap is hour 7 on Fri 4 Sep, which was
not recorded (treated as not held). Sat 31 Oct was a teaching day by circular PU/2026/234, but the
report has no entry for it, so it is not counted. `COUNT_SUSPENDED_AS_ABSENT` in `history.ts`
counts suspended hours as held but not attended; set it to `false` to match the portal.

Classes from 11 to 19 Nov are inside the plan window, so they come in as marks (P attended, A
skipped) for any class you had not marked yourself (revision 5).

## Plan window and extra working days

- **Start:** `WINDOW_START`, 2026-11-11, fixed in [`src/lib/config.ts`](src/lib/config.ts).
- **End:** the `windowEnd` setting, **Settings > Plan until**. Default 2026-12-05. The header
  ("till 5 Dec"), color key, allowance table and popover texts all use it.
- **Term end:** the academic year ends on Tue 1 Dec, so Wed 2 to Fri 4 Dec have no classes. They
  are fixed in `FIXED_MUTED_DAYS` in [`src/lib/config.ts`](src/lib/config.ts) (shown muted as
  "No classes: term ended 1 Dec") and win over an extra working day on the same date. Sat 5 Dec is
  the only teaching day after 1 Dec.
- **Extra working days:** `extraWorkingDays`, a list of `{ date, followsWeekday, reason }`, edited
  in **Settings > Extra working days**. The defaults are two Saturdays on Monday's timetable
  (MAT2303 period 1, CSE2255 period 2, CSE2254 periods 3 to 4): **Sat 21 Nov** and **Sat 5 Dec**,
  the make-up for the Mon 9 Nov holiday. A day must be inside the window and not a Sunday. A
  holiday on the same date wins. A listed day that falls outside the window after "Plan until"
  moves is kept but ignored.

  Saved states already have their own list, so a new default day reaches them through a revision
  step (`EXTRA_DAY_ADDITIONS` in `config.ts`, revision 3 for 21 Nov): it is added once if the state
  has no entry for that date. One you set by hand, or remove afterwards, is left as it is.

Weeks are built from the window, Monday-based, so tabs appear or disappear when "Plan until"
moves. A week shows Monday to Friday, plus a Saturday row only when that Saturday is an extra
working day; Sunday is never shown. Days in a shown week but outside the window are muted
"Outside plan". Session ids stay `${date}@${startPeriod}`, so marks keep working. The rules are
unchanged: a longer window just means more remaining hours, which raises some budgets.

## Cloud sync

### How it works

```
Browser (each device)                    Vercel (server)                Appwrite
-----------------------------            ---------------------          ------------------
Planner UI                               /api/planner                   planner_versions
  usePlannerSync -> SyncEngine   <---->    GET: newest version    <-->    one row per version:
  IndexedDB cache (this device)            PUT: save as n+1 only            v1, v2, ... (state
                                           if still at n (else 409)         JSON + version)
```

- **The cloud is the source of truth.** The newest row in `planner_versions` holds the whole
  `AppState` (settings, ODs, baseline, plan window, marks) as JSON, plus its `version` number.
  The plan itself is still computed in the browser by `computePlan()`; only the inputs are
  stored. The last 200 versions are kept as history; older ones are pruned.
- **The browser never talks to Appwrite.** It calls `/api/planner` on this app. The route uses an
  Appwrite API key that exists only on the server. The table has no permissions and no row
  security, so nothing but a server API key can read or change it.
- **Access key.** Every request to `/api/planner` must carry the key from the server's
  `PLANNER_ACCESS_KEY` (`Authorization: Bearer <key>`), checked in constant time before the
  database is touched. Without it the API answers 401. With no key configured on the server it
  refuses everyone (fails closed). Each device stores its copy of the key in localStorage.
- **No silent overwrites.** Every save sends the version it was based on, and the server sets the
  new version itself. Saving on top of version n means creating the row `v{n+1}`: Appwrite refuses
  a row id that already exists, and a unique index on `version` backs that up, so of two devices
  saving from the same version exactly one succeeds. The other gets 409 with what is there now and
  merges. After each save the server also checks that its row is the newest, which rules out a
  device hundreds of saves behind slipping into pruned history. Reads ask Appwrite not to cache.
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

### Set up Appwrite

1. Create a project at [cloud.appwrite.io](https://cloud.appwrite.io) (the free plan is plenty).
2. In the project's **Settings**, note the **API endpoint** (for example
   `https://fra.cloud.appwrite.io/v1`) and the **Project ID**.
3. **Overview** > **API keys** > **Create API key**. Give it the scopes **databases**, **tables**,
   **columns**, **indexes** and **rows** (read and write each) and copy the secret. For tighter
   security you can later make a second key with only `rows.read` and `rows.write` for Vercel;
   the broader scopes are only needed by the setup script.
4. Make an access key: a long random string, at least 24 characters (shorter ones are refused).
   For example:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   Keep it somewhere safe, such as a password manager.
5. Copy `.env.example` to `.env.local` and fill in `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`,
   `APPWRITE_API_KEY` and `PLANNER_ACCESS_KEY`. `.env.local` is git-ignored.
6. Create the database, table, columns and index (safe to run again):

   ```bash
   npm run setup:appwrite
   ```

   It makes database `planner` with table `planner_versions`: an integer column `version`, a
   mediumtext column `state`, a unique index on `version`, no permissions and no row security.
   To do it by hand in the console instead, create exactly that.
7. On Vercel: **Project** > **Settings** > **Environment Variables**, add the same four variables
   for Production (and Preview if you use it), then redeploy. Never prefix them with
   `NEXT_PUBLIC_`.
8. Open the app on each device. It shows **Cloud sync is locked on this device**: paste the access
   key and press **Unlock sync**. The status turns to **Cloud synced**, and your existing data is
   uploaded as described above. You can change or forget the key later in **Settings > Cloud
   access key**.

Without the variables the API answers "not configured", the status shows **Sync error**, and the
app keeps everything on the device. To lock out a lost device, change `PLANNER_ACCESS_KEY` on
Vercel, redeploy, and enter the new key on the devices you still use.

You do not need Appwrite Realtime: sync works through the app's API.

### Limitations

- **One shared key, no accounts.** Anyone with the access key can read and change the planner, so
  keep it private. There is no rate limit on wrong guesses; a random key of 32 bytes makes guessing
  hopeless, which is why short keys are refused. The key sits in each device's localStorage, so
  anyone using that browser profile can use it.
- Changes from another device appear within about 15 s while the tab is open, not instantly.
- Two tabs on the same device share one cache. If one tab is closed within a second of an edit
  while offline, that edit can be overwritten in the cache by the other tab (it is still sent if
  the closing tab's last save got out).
- Appwrite's free plan may pause projects that see no activity for a long time; the app then shows
  **Sync error** until the project is resumed from the console, and keeps working on the device
  meanwhile.
- Each save adds a row (a few KB). History is pruned to the last 200 versions, so storage stays
  small.

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

**The current defaults** (`PORTAL_BASELINE`, as of 10 Nov 2026, revision 4) come from the past
record, not from the portal's per-course totals, which had hours on the wrong courses. Held hours
total 334: the portal's 313 plus 21 suspended hours. Present hours total 290.

| Course | Present / held | Course | Present / held |
| --- | --- | --- | --- |
| Data Comm & Networks | 34 / 37 | Data Structures | 30 / 37 |
| DCCN Lab | 20 / 22 | Linear Algebra | 35 / 45 |
| Aptitude | 18 / 20 | OOP Java | 24 / 31 |
| Web Tech Lab | 24 / 26 | Web Tech | 32 / 37 |
| Comp Org & Arch | 30 / 33 | OOP Java Lab | 23 / 26 |
| DS Lab | 20 / 20 | | |

**After a new daily report:** dump it to `src/lib/historyData.ts` (one string of hour codes per
day), move `BASELINE_AS_OF`, update `PORTAL_BASELINE` to what `historyTotals()` gives, and run
`npm test` (history.test.ts checks every day against its timetable).

**How a correction reaches devices that already saved the old numbers.** The baseline is saved as
a full copy inside the state (on each device, in its confirmed copy, and in the cloud row), so
changing `config.ts` alone would not reach them. Each saved state carries
`settings.baselineRevision` (missing means 1). `migrateState()` in
[`src/lib/storage.ts`](src/lib/storage.ts) brings an older state up to `BASELINE_REVISION`: a
course is replaced only if it still equals the old default exactly, so anything you typed by
hand is kept. It runs everywhere a state comes in: the old localStorage copies, the IndexedDB
cache (shown and confirmed copies), and every reply from `/api/planner` before it is compared or
merged. So two devices migrating on their own end up identical, with no false conflict. It works
offline and with sync not set up. If the cloud row is still on an older revision, the corrected
values count as a normal local change and are saved to the cloud once.

**In the code (the new defaults for every device):**

1. Edit `PORTAL_BASELINE` and `BASELINE_AS_OF` in [`src/lib/config.ts`](src/lib/config.ts). Remove
   an OD from `ODS` once the portal counts it for good, or add new ones.
2. If devices or the cloud already hold the old numbers, raise `BASELINE_REVISION` and add a step to
   `BASELINE_CORRECTIONS` listing each changed course as `[old default, new default]` (or to
   `EXTRA_DAY_ADDITIONS` for a new working day). Devices then pick it up on their next load.
3. `npm test` will now fail on the fixtures in `src/lib/plan.test.ts`, because they are written
   for the current baseline and these ten ODs. Update or remove those expectations.
4. Commit and push. Vercel redeploys on its own.

A swapped day in the future needs no code: add an extra working day on that weekday in
**Settings > Extra working days**, following the timetable it actually ran. It overrides that
day's normal timetable.

Holidays work the same way: add them in **Settings > Holidays**, or put them in
`DEFAULT_HOLIDAYS` in `config.ts`.

## Deploy on Vercel

The app is a standard Next.js project. Vercel detects the framework. For cloud sync it needs the
four environment variables from [Set up Appwrite](#set-up-appwrite); without them it still builds
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

With Appwrite set up, the phone and your laptop show the same planner.

## Project layout

```
src/lib/config.ts     window, periods, timetable, courses, portal baseline, ODs, default settings
src/lib/plan.ts       rules engine: computePlan, diffPlans, diffBudgets
src/lib/plan.test.ts  engine tests, including the fixture numbers
src/lib/dates.ts      YYYY-MM-DD helpers (no timezone traps)
src/lib/storage.ts    validation, legacy localStorage read, v1/v2 to v3 migration
src/lib/history.ts    past record: old timetable, swap days, totals (historyData.ts holds the report)
src/lib/sync.ts       sync engine: reconcile (syncState), push, retry, conflicts
src/lib/merge.ts      three-way merge of two states, entry by entry
src/lib/remote.ts     client for /api/planner (loadRemoteState, saveRemoteState)
src/lib/localCache.ts IndexedDB cache (loadLocalCache, saveLocalCache)
src/lib/server/       API request handling, versioned store, Appwrite repository (server only)
src/app/api/planner/  the GET / PUT route
scripts/setup-appwrite.mjs   creates the Appwrite database and table (npm run setup:appwrite)
src/lib/view.ts       labels and text shared by the views
src/components/       Planner, DesktopGrid, MobileDays, SessionDialog, SettingsDrawer, ...
src/app/              layout (fonts, metadata), page, manifest
scripts/generate-icons.mjs   redraws the icons in public/ (npm run icons)
```
