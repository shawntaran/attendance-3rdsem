# Skip Planner

A mobile-first web app for section 3CSE02 that answers one question for every class between
11 Nov and 1 Dec 2026: **can I skip this, or do I have to go?** The goal is to finish every one
of the 11 courses at 75% attendance or more on 1 Dec 2026.

- One timetable per week. Each class is green ("Can skip") or red ("Attend").
- Tap a class to say "I attended this" or "I skipped this". The plan recalculates at once and a
  toast tells you what moved, with an Undo.
- A live table shows, per course: attendance now, skippable hours left, skips used, and the
  final % if you skip every green class.
- Two scenarios, because some OD (on-duty) requests are still pending: **ODs granted** (default)
  and **ODs pending**.
- No backend, no database, no environment variables. Everything is saved in your browser's
  `localStorage` under the key `skip-planner:v1`.
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
(window, periods, timetable, courses, baseline) is in [`src/lib/config.ts`](src/lib/config.ts).

`computePlan({ settings, marks, today })` works on each course independently. Marks are
`Record<sessionId, 'attended' | 'skipped'>`, and a session id is `${date}@${startPeriod}`.
Labs and aptitude span 2 periods and count as 2 hours.

1. **Sessions.** Take every timetable session of the course in the window (2026-11-11 to
   2026-12-01, weekdays), remove holidays, remove dates on or before `baselineAsOf` (those are
   already inside the baseline), and sort by date and period.
2. **Walk them.** Start with `P` = baseline present hours and `H` = baseline held hours. For each
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
"Comp Org & Arch: skip moved from Tue 1 Dec to Wed 11 Nov"). The toasts use it.

Dates are plain `YYYY-MM-DD` strings throughout. The code never calls `new Date("YYYY-MM-DD")`,
which would be read as UTC and can land on the wrong day.

## Updating the baseline after a new attendance export

The baseline is your present and held hours per course on a given date (DL counted as present,
SUS excluded). Everything after that date is tracked by the app.

**In the app (quickest, this device only):**

1. Open **Settings**.
2. Pick the scenario you are updating (ODs granted or ODs pending). Each has its own table.
3. Set **Baseline as of** to the last date your export covers.
4. Type the new **Present** and **Held** hours for each course.
5. Classes on or before the new date are now inside the baseline, so the app ignores any marks
   on them. You do not need to clear them.

**In the code (the new defaults for every device):**

1. Edit `BASELINES` and `BASELINE_AS_OF` in [`src/lib/config.ts`](src/lib/config.ts).
2. `npm test` will now fail on the fixtures in `src/lib/plan.test.ts`, because they are written
   for the 10 Nov baseline. Update or remove those expectations.
3. Commit and push. Vercel redeploys on its own.
4. A browser that already saved its own settings keeps them. Use **Settings > Reset everything**
   on that device to pick up the new defaults.

Holidays work the same way: add them in **Settings > Holidays**, or put them in
`DEFAULT_HOLIDAYS` in `config.ts`.

## Deploy on Vercel

The app is a standard Next.js project. Vercel detects the framework and needs no settings and no
environment variables.

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

Your marks live in that browser on that device. They do not sync between devices.

## Project layout

```
src/lib/config.ts     window, periods, timetable, courses, baselines, default settings
src/lib/plan.ts       rules engine: computePlan, diffPlans
src/lib/plan.test.ts  engine tests, including the fixture numbers
src/lib/dates.ts      YYYY-MM-DD helpers (no timezone traps)
src/lib/storage.ts    localStorage load, validate, save
src/lib/view.ts       labels and text shared by the views
src/components/       Planner, DesktopGrid, MobileDays, SessionDialog, SettingsDrawer, ...
src/app/              layout (fonts, metadata), page, manifest
scripts/generate-icons.mjs   redraws the icons in public/ (npm run icons)
```
