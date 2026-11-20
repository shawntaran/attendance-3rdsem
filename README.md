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
- Accounts with just a name and a PIN. Each person uploads the portal's Daily Attendance export
  (.xlsx) and gets their own plan: every present, absent, DL and suspended hour is placed on the
  timetable it ran on (old timetable until 16 Sep, current from 17 Sep).
- Each person adds their own ODs (on-duty leaves): a reason, one or more days, and which hours.
  Each OD has a switch, because each one is granted or not on its own.
- Cloud sync per person: the same planner on every device you sign in on, through this app's own
  API (Supabase or Appwrite behind it). It keeps working offline and syncs when the connection is
  back. See [Accounts and cloud sync](#accounts-and-cloud-sync).
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

Each person keeps their own list in `settings.ods`: `{ id, reason, slots: [{ date, hours }] }`,
where `hours` are teaching hours (1 to 4, 6 to 8). **ODs > + Add an OD** asks for a reason, one or
more days, and the hours of each day (all of them by default, "Whole day" toggles them). Each OD has
a switch (`odState[id].on`), **Count all / Count none**, and **Remove**.

What an OD that is switched on does depends on the day:

- **Before the plan (on or before `baselineAsOf`):** hours that are *absent* in your uploaded
  record become present in the baseline (the course gets +1 present per hour; held is unchanged,
  as those hours are already held). Hours already DL or present add nothing, so an OD the portal
  has caught up on simply shows "Nothing to count" once you upload a newer export.
- **In the plan:** every class in those hours shows **On duty** and counts as present (attended
  and held), whatever is marked there. Switching the OD off brings the marks back.

The list shows the hours per course each OD adds, and every change shows a toast with the skip
budgets that moved, with an Undo.

The two ODs of the single-user version (29 Sep hour 3, French event; 17 and 18 Nov whole days,
STEM for Impact Hackathon) are added to that planner when it is moved into an account (revision 6),
with its switches kept.

## Past record

Each person uploads the portal's **Daily Attendance** report as an Excel file: on first sign-in
(the "add your attendance" card), in **Settings > Your attendance record**, or in **Past record**.
The file is read in the browser ([`src/lib/recordImport.ts`](src/lib/recordImport.ts), no
library: the xlsx zip is opened with `DecompressionStream`); only the hour codes are kept, as
`settings.record = { days: [[date, "PPAD.S.."]], holidays: [[date, name]], uploadedAt }`
(P present, A absent, D DL/OD, S suspended/blocked, `.` no class). Before saving, the app shows the
date range and lists any day whose hours do not fit the timetable that day ran.

[`src/lib/history.ts`](src/lib/history.ts) places each hour on its course:

- **Until 16 Sep:** the old timetable (`OLD_TIMETABLE`). It differs from the current one on
  Monday (OOP Java hour 1, Linear Algebra hour 2), Thursday (Comp Org in hour 6) and Friday
  (Web Tech hour 1, Linear Algebra hour 7, no hour 8).
- **From 17 Sep:** the current timetable.
- **Wed 9 Sep** ran Friday's timetable (`HISTORY_DAY_TIMETABLES`).

From the record:

- **Baseline:** present and held per course up to `baselineAsOf` (10 Nov). DL counts as present.
  Suspended hours count as held but not attended, unless the person switches off **Count suspended
  hours as missed** in Settings.
- **Marks:** classes after `baselineAsOf` that the record covers become marks (all hours present
  or DL: attended; none: skipped; a lab split both ways is left unmarked). An upload replaces the
  marks on the days it covers and keeps the rest.

**Plan / Past record** next to the week tabs shows every week of the record laid out as the
timetable it ran, with each class marked **Present**, **Absent**, **OD (DL)** or **Suspended**,
holidays named, and totals per course.

Without a record, the baseline is what was typed in **Settings > Or type the portal totals**
(all zero for a new account).

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

## Accounts and cloud sync

### Signing in

- **Name + PIN.** The name is turned into a key (lowercase, letters and digits, dashes between
  words: "Shawn T" becomes `shawn-t`), so names are case-insensitive and first come, first served.
  The PIN is 4 to 6 digits, stored only as a scrypt hash.
- **Wrong PINs:** after 5 in a row the name is locked for 15 minutes. An unknown name and a wrong
  PIN get the same answer, so the sign-in form does not reveal who has an account.
- **Session:** an httpOnly, SameSite=Lax cookie (`sp_session`, Secure in production) holding the
  name key and expiry, signed with HMAC-SHA256 using `SESSION_SECRET`. It lasts 180 days.
  Changing `SESSION_SECRET` signs everyone out.
- **Forgotten PIN:** there is no reset. Delete the person's row from `users` in the database
  console (on Supabase that also deletes their planner; on Appwrite delete their `planner_versions`
  rows too) and they sign up again.
- **Offline:** the app opens the last account used on the device from its cache, and syncs once
  the connection is back.
- **No database configured:** the sign-in screen offers **Use on this device**, which keeps the
  planner on the device only.
- **Moving the old planner in:** a device that used the app before accounts is asked, on the first
  sign-in, whether that planner belongs to this person. **Yes** uploads it to the account (with the
  revision 6 migration: the built-in past record and the two old ODs); **No** starts fresh.

### How sync works

```
Browser (each device)                    Server (Vercel or Render)          Database
-----------------------------            -------------------------          -----------------------
Sign-in screen                           /api/auth/signup, login,           users
                                           logout, me (sets the cookie)       one row per person
Planner UI                               /api/planner (needs the cookie)    planner_versions
  usePlannerSync -> SyncEngine   <---->    GET: your newest version   <-->    one row per version
  IndexedDB cache per person               PUT: save as n+1 only              per person
                                           if still at n (else 409)
```

- **The cloud is the source of truth.** A person's newest row in `planner_versions` holds their
  whole `AppState` (settings, record, ODs, plan window, marks) as JSON. The plan itself is
  computed in the browser by `computePlan()`. The last 200 versions per person are kept.
- **The browser never talks to the database.** It calls this app's API; the database key exists
  only on the server, and the tables refuse everyone else (see below).
- **No silent overwrites.** Every save sends the version it was based on. Saving on top of version
  n means inserting `(person, n+1)`, which the primary key (Supabase) or row id plus unique index
  (Appwrite) lets exactly one writer do. The other gets 409 with the current copy and merges.
- **Local first.** The app shows this device's cached copy at once, then reconciles with the cloud.
  Edits are cached immediately and sent after a 0.8 s pause; other devices' changes are picked up
  every 15 s while the tab is visible and on focus or reconnect.
- **Merging, not last-write-wins.** Unsent changes are merged entry by entry: each mark, setting,
  OD, record day, holiday and extra working day. Only the same entry changed differently on two
  devices is a conflict.
- **Offline.** Edits stay pending in IndexedDB and are retried; a failed save never drops them.

The status next to the week title shows **Cloud synced**, **Saving...**, **Sync pending**,
**Offline** or **Sync error** (tap it to retry). If the session has ended, a banner offers
**Sign in again**; changes stay on the device meanwhile.

### Conflicts and recovery

- **Same entry changed on two devices:** the cloud value is used, everything else is merged, and a
  banner lists what clashed. **Use this device's values** puts this device's values back.
- **This device has different data from the cloud on its first sync:** the cloud copy is shown and
  nothing is uploaded until you pick **Keep the cloud copy** or **Use this device's copy**.
- Both banners have **Download this device's copy** (a JSON file).
- A stored state that does not validate is reported as **Sync error** and never written over.

### Database structure

Both backends store the same two things. The server picks one: `DATABASE=supabase|appwrite`
forces it; otherwise Supabase if `SUPABASE_URL` and a secret key are set, else Appwrite. Each
database has its own accounts, so the Render (Supabase) and Vercel (Appwrite) deployments are
separate apps with separate data.

**Supabase** ([`supabase/migrations/0002_multi_user.sql`](supabase/migrations/0002_multi_user.sql)):

| Table | Column | Type | Notes |
| --- | --- | --- | --- |
| `users` | `key` | text, primary key | name key, 2 to 24 of `a-z 0-9 -` |
| | `name` | text | as typed (display) |
| | `pin_hash` | text | `scrypt$N$salt$hash` |
| | `failed_attempts` | integer, default 0 | wrong PINs in a row |
| | `locked_until` | timestamptz, null | set after 5 wrong PINs |
| | `created_at` | timestamptz | |
| `planner_versions` | `user_key` | text, references `users(key)` on delete cascade | |
| | `version` | bigint, ≥ 1 | primary key is `(user_key, version)` |
| | `state` | text | the `AppState` JSON |
| | `created_at` | timestamptz | |

Row level security is enabled and forced with no policies, and `anon` / `authenticated` have no
grants; only `service_role` (the server's secret key) can read or write.

**Appwrite** (database `planner`, made by `npm run setup:appwrite`; no permissions, no row
security):

| Table | Row id | Columns |
| --- | --- | --- |
| `users` | the name key | `name` varchar 24, `pinHash` varchar 200, `failedAttempts` integer, `lockedUntil` varchar 40 (ISO time or null) |
| `planner_versions` | `{key}-v{version}` | `user` varchar 24, `version` integer, `state` mediumtext; unique index `user_version_unique` on (`user`, `version`) |

Rows of the single-user version (no `user`) are no longer read; delete them whenever you like.
The setup script removes the old `version_unique` index, which would stop two people both having
a version 1.

### Set up Supabase and Render

1. **Supabase project** (region Singapore). In **Project Settings > Data API**, keep the Data API
   on and **turn off** "Automatically expose new tables"; leave automatic RLS off too (the SQL
   turns RLS on itself).
2. **SQL Editor > New query**, paste all of
   [`supabase/migrations/0002_multi_user.sql`](supabase/migrations/0002_multi_user.sql), **Run**.
   It is safe to run again.
3. **Project Settings > Data API**: copy the **Project URL** (`SUPABASE_URL`). **Project Settings >
   API Keys > Secret keys**: create or copy one (`SUPABASE_SECRET_KEY`, starts `sb_secret_`).
4. **Render > New > Blueprint**, pick this repository. It reads [`render.yaml`](render.yaml): a
   Node web service in Singapore, build `npm ci && npm run build`, start `npm start`, with
   `DATABASE=supabase` and a generated `SESSION_SECRET`. Paste `SUPABASE_URL` and
   `SUPABASE_SECRET_KEY` when asked. (Without the blueprint: **New > Web Service**, same build and
   start commands, region Singapore, and add the four variables by hand.)
5. Open the Render URL, choose **New here**, pick a name and PIN, and upload your attendance.

Render's free plan sleeps after 15 minutes without visits; the first visit after that takes
about a minute while it wakes up. The app keeps working from the device cache meanwhile.

### Set up Appwrite (Vercel)

1. Create a project at [cloud.appwrite.io](https://cloud.appwrite.io). Note the **API endpoint**
   and **Project ID** (project **Settings**).
2. **Overview > API keys > Create API key** with **databases**, **tables**, **columns**,
   **indexes** and **rows** (read and write). The app itself only needs `rows.read` and
   `rows.write`, so Vercel can use a narrower key.
3. Copy `.env.example` to `.env.local`, fill in the Appwrite block and `SESSION_SECRET`, then run
   (safe to run again; it also upgrades a database made for the single-user version):

   ```bash
   npm run setup:appwrite
   ```

4. On Vercel: **Project > Settings > Environment Variables**: `APPWRITE_ENDPOINT`,
   `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` and `SESSION_SECRET`, then redeploy. Remove the old
   `PLANNER_ACCESS_KEY`; it is no longer used.

### Limitations

- A 4 to 6 digit PIN is weak on its own; the lock after 5 wrong tries is what keeps guessing slow.
  Do not reuse a PIN that protects anything else.
- Anyone can create an account on the deployment; names are first come, first served.
- Changes from another device appear within about 15 s, not instantly.
- Free plans pause or sleep: Appwrite may pause an idle project, Render sleeps after 15 minutes and
  Supabase pauses a project after a week without activity. The app shows **Sync error** or
  **Offline** meanwhile and keeps working on the device.

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

## Updating your record

Download a newer Daily Attendance report from the portal and upload it in **Settings > Your
attendance record > Upload a newer file**. It replaces the record: the baseline is rebuilt, the
days it covers after 10 Nov replace the marks on those classes, and ODs the portal now shows as
DL stop adding anything. A toast lists the skip budgets that moved, with an Undo.

Without a record, **Settings > Or type the portal totals** still takes present and held hours per
course with a **Baseline as of** date, as before.

**For maintainers.** Saved states carry `settings.baselineRevision`; `migrateState()` in
[`src/lib/storage.ts`](src/lib/storage.ts) brings an older state up to `BASELINE_REVISION` (6)
wherever a state comes in (the cache, every server reply). Revisions 2 to 4 corrected the
single-user baseline, 5 brought in marks from the record, and 6 is accounts: the built-in record
(`historyData.ts`) and the two old ODs are attached to a planner that predates them. A swapped day
in the future needs no code: add an extra working day in **Settings > Extra working days**.
Holidays: **Settings > Holidays**, or `DEFAULT_HOLIDAYS` in `config.ts`.

## Deploy on Vercel

The app is a standard Next.js project. Vercel detects the framework. For accounts and sync it
needs the variables from [Set up Appwrite](#set-up-appwrite-vercel); without them it still builds
and runs, offering "Use on this device". For Render and Supabase see
[Set up Supabase and Render](#set-up-supabase-and-render).

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

Sign in with the same name and PIN on the phone and your laptop and they show the same planner.

## Project layout

```
src/lib/config.ts     window, periods, timetable, courses, default settings
src/lib/plan.ts       rules engine: computePlan, diffPlans, diffBudgets
src/lib/plan.test.ts  engine tests, including the fixture numbers
src/lib/dates.ts      YYYY-MM-DD helpers (no timezone traps)
src/lib/storage.ts    validation, legacy localStorage read, v1/v2 to v3 migration
src/lib/history.ts    past record: old timetable, swap days, totals (historyData.ts holds the report)
src/lib/sync.ts       sync engine: reconcile (syncState), push, retry, conflicts
src/lib/merge.ts      three-way merge of two states, entry by entry
src/lib/recordImport.ts  reads the portal's Daily Attendance .xlsx in the browser
src/lib/account.ts    client for /api/auth (whoAmI, signIn, signUp, signOut)
src/lib/remote.ts     client for /api/planner (loadRemoteState, saveRemoteState)
src/lib/localCache.ts IndexedDB cache, one per person on the device
src/lib/server/       auth (PIN hashing, sessions), versioned store, Supabase and Appwrite repositories
src/app/api/          auth routes and the planner GET / PUT route
supabase/migrations/  the Supabase tables (run once in the SQL editor)
scripts/setup-appwrite.mjs   creates the Appwrite database and tables (npm run setup:appwrite)
render.yaml           Render blueprint (Singapore, Supabase)
src/lib/view.ts       labels and text shared by the views
src/components/       Planner, DesktopGrid, MobileDays, SessionDialog, SettingsDrawer, ...
src/app/              layout (fonts, metadata), page, manifest
scripts/generate-icons.mjs   redraws the icons in public/ (npm run icons)
```
