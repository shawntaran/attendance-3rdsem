// One-time setup of the Appwrite database for cloud sync. Safe to run again:
// anything that already exists is left as it is.
//
//   node --env-file=.env.local scripts/setup-appwrite.mjs
//   (or: npm run setup:appwrite)
//
// Needs APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and an APPWRITE_API_KEY with the
// databases, tables, columns and indexes (read + write) scopes. The app itself
// only needs rows.read and rows.write, so you can use a narrower key on Vercel.

import { AppwriteException, Client, TablesDB, TablesDBIndexType } from "node-appwrite";

const endpoint = process.env.APPWRITE_ENDPOINT;
const project = process.env.APPWRITE_PROJECT_ID;
const key = process.env.APPWRITE_API_KEY;
const databaseId = process.env.APPWRITE_DATABASE_ID || "planner";
const tableId = process.env.APPWRITE_TABLE_ID || "planner_versions";

if (!endpoint || !project || !key) {
  console.error("Set APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID and APPWRITE_API_KEY (e.g. in .env.local) first.");
  process.exit(1);
}

const db = new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setKey(key));

/** Run a create call; an "already exists" (409) answer counts as done. */
async function ensure(label, fn) {
  try {
    await fn();
    console.log(`created  ${label}`);
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 409) {
      console.log(`exists   ${label}`);
      return;
    }
    console.error(`failed   ${label}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

/** Columns and indexes are built in the background; wait until they are usable. */
async function waitFor(label, get) {
  for (let i = 0; i < 60; i++) {
    const { status } = await get();
    if (status === "available") return;
    if (status === "failed" || status === "stuck") {
      console.error(`failed   ${label}: status ${status}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`timeout  ${label} is still processing; run the script again in a minute.`);
  process.exit(1);
}

await ensure(`database "${databaseId}"`, () => db.create({ databaseId, name: "Skip Planner" }));

// No permissions and no row security: only server API keys can read or write.
await ensure(`table "${tableId}"`, () =>
  db.createTable({ databaseId, tableId, name: "Planner versions", permissions: [], rowSecurity: false }),
);

await ensure("column version (integer)", () =>
  db.createIntegerColumn({ databaseId, tableId, key: "version", required: true, min: 1 }),
);
await ensure("column state (mediumtext)", () =>
  db.createMediumtextColumn({ databaseId, tableId, key: "state", required: true }),
);
await waitFor("column version", () => db.getColumn({ databaseId, tableId, key: "version" }));
await waitFor("column state", () => db.getColumn({ databaseId, tableId, key: "state" }));

// Two saves of the same version can never both exist.
await ensure("unique index on version", () =>
  db.createIndex({ databaseId, tableId, key: "version_unique", type: TablesDBIndexType.Unique, columns: ["version"] }),
);
await waitFor("index version_unique", () => db.getIndex({ databaseId, tableId, key: "version_unique" }));

console.log(`\nDone. Database "${databaseId}", table "${tableId}" are ready for /api/planner.`);
