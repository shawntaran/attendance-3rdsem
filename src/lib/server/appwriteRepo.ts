import "server-only";

import { AppwriteException, Client, Query, TablesDB } from "node-appwrite";
import type { PlannerRepo } from "./plannerApi";
import { versionedRepo, type VersionRow, type VersionStore } from "./versionedRepo";

/** Defaults match scripts/setup-appwrite.mjs; override with env vars if you named them differently. */
export const DEFAULT_DATABASE_ID = "planner";
export const DEFAULT_TABLE_ID = "planner_versions";

interface Row {
  version: number;
  state: string;
  $createdAt: string;
}

function toVersionRow(row: Row): VersionRow {
  return { version: Number(row.version), state: row.state, createdAt: row.$createdAt };
}

function isConflict(err: unknown): boolean {
  return err instanceof AppwriteException && err.code === 409;
}

let tables: TablesDB | null = null;

/**
 * The server-side Appwrite client, using an API key that exists only on the
 * server. Returns null when the environment variables are not set, so the API
 * answers "not configured" instead of crashing.
 */
function getTables(): TablesDB | null {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const project = process.env.APPWRITE_PROJECT_ID;
  const key = process.env.APPWRITE_API_KEY;
  if (!endpoint || !project || !key) return null;
  tables ??= new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
  return tables;
}

export function appwriteRepo(): PlannerRepo | null {
  const db = getTables();
  if (!db) return null;
  const databaseId = process.env.APPWRITE_DATABASE_ID || DEFAULT_DATABASE_ID;
  const tableId = process.env.APPWRITE_TABLE_ID || DEFAULT_TABLE_ID;

  const store: VersionStore = {
    async latest() {
      const list = await db.listRows<Row & import("node-appwrite").Models.Row>({
        databaseId,
        tableId,
        queries: [Query.orderDesc("version"), Query.limit(1)],
        total: false,
        ttl: 0, // never serve a cached "latest version"
      });
      return list.rows[0] ? toVersionRow(list.rows[0]) : null;
    },

    async create(version, state) {
      try {
        const row = await db.createRow<Row & import("node-appwrite").Models.Row>({
          databaseId,
          tableId,
          // The id is fixed by the version, so a second writer of the same
          // version is refused (409); the unique index on `version` backs it up.
          rowId: `v${version}`,
          data: { version, state },
        });
        return toVersionRow(row);
      } catch (err) {
        if (isConflict(err)) return "exists";
        throw err;
      }
    },

    async remove(version) {
      await db.deleteRow({ databaseId, tableId, rowId: `v${version}` });
    },

    async pruneBelow(version) {
      await db.deleteRows({ databaseId, tableId, queries: [Query.lessThan("version", version)] });
    },
  };

  return versionedRepo(store);
}
