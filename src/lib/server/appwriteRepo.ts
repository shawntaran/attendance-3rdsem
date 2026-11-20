import "server-only";

import { AppwriteException, Client, Query, TablesDB, type Models } from "node-appwrite";
import type { UserRecord, UserRepo } from "./auth";
import type { PlannerRepo } from "./plannerApi";
import { versionedRepo, type VersionRow, type VersionStore } from "./versionedRepo";

/** Defaults match scripts/setup-appwrite.mjs; override with env vars if you named them differently. */
export const DEFAULT_DATABASE_ID = "planner";
export const DEFAULT_TABLE_ID = "planner_versions";
export const DEFAULT_USERS_TABLE_ID = "users";

interface VersionRowData {
  user: string;
  version: number;
  state: string;
}

interface UserRowData {
  name: string;
  pinHash: string;
  failedAttempts: number;
  lockedUntil: string | null;
}

function isConflict(err: unknown): boolean {
  return err instanceof AppwriteException && err.code === 409;
}

function isNotFound(err: unknown): boolean {
  return err instanceof AppwriteException && err.code === 404;
}

let tables: TablesDB | null = null;

/**
 * The server-side Appwrite client, using an API key that exists only on the
 * server. Null when the environment variables are not set, so the API answers
 * "not configured" instead of crashing.
 */
function getTables(): TablesDB | null {
  const endpoint = process.env.APPWRITE_ENDPOINT;
  const project = process.env.APPWRITE_PROJECT_ID;
  const key = process.env.APPWRITE_API_KEY;
  if (!endpoint || !project || !key) return null;
  tables ??= new TablesDB(new Client().setEndpoint(endpoint).setProject(project).setKey(key));
  return tables;
}

function ids() {
  return {
    databaseId: process.env.APPWRITE_DATABASE_ID || DEFAULT_DATABASE_ID,
    tableId: process.env.APPWRITE_TABLE_ID || DEFAULT_TABLE_ID,
    usersTableId: process.env.APPWRITE_USERS_TABLE_ID || DEFAULT_USERS_TABLE_ID,
  };
}

export function appwriteConfigured(): boolean {
  return getTables() !== null;
}

/** One person's planner: their own versions, rows `{user}-v{n}`. */
export function appwritePlannerRepo(user: string): PlannerRepo | null {
  const db = getTables();
  if (!db) return null;
  const { databaseId, tableId } = ids();
  const toVersionRow = (row: VersionRowData & Models.Row): VersionRow => ({
    version: Number(row.version),
    state: row.state,
    createdAt: row.$createdAt,
  });

  const store: VersionStore = {
    async latest() {
      const list = await db.listRows<VersionRowData & Models.Row>({
        databaseId,
        tableId,
        queries: [Query.equal("user", user), Query.orderDesc("version"), Query.limit(1)],
        total: false,
        ttl: 0, // never serve a cached "latest version"
      });
      return list.rows[0] ? toVersionRow(list.rows[0]) : null;
    },

    async create(version, state) {
      try {
        const row = await db.createRow<VersionRowData & Models.Row>({
          databaseId,
          tableId,
          // Fixed by user and version, so a second writer of the same version
          // is refused (409); the unique index on (user, version) backs it up.
          rowId: `${user}-v${version}`,
          data: { user, version, state },
        });
        return toVersionRow(row);
      } catch (err) {
        if (isConflict(err)) return "exists";
        throw err;
      }
    },

    async remove(version) {
      await db.deleteRow({ databaseId, tableId, rowId: `${user}-v${version}` });
    },

    async pruneBelow(version) {
      await db.deleteRows({
        databaseId,
        tableId,
        queries: [Query.equal("user", user), Query.lessThan("version", version)],
      });
    },
  };

  return versionedRepo(store);
}

/** Accounts: row id is the normalized name. */
export function appwriteUserRepo(): UserRepo | null {
  const db = getTables();
  if (!db) return null;
  const { databaseId, usersTableId } = ids();
  const toUser = (key: string, row: UserRowData): UserRecord => ({
    key,
    name: row.name,
    pinHash: row.pinHash,
    failedAttempts: Number(row.failedAttempts ?? 0),
    lockedUntil: row.lockedUntil ?? null,
  });

  return {
    async get(key) {
      try {
        const row = await db.getRow<UserRowData & Models.Row>({ databaseId, tableId: usersTableId, rowId: key });
        return toUser(key, row);
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async create(user) {
      try {
        const row = await db.createRow<UserRowData & Models.Row>({
          databaseId,
          tableId: usersTableId,
          rowId: user.key,
          data: { name: user.name, pinHash: user.pinHash, failedAttempts: 0, lockedUntil: null },
        });
        return toUser(user.key, row);
      } catch (err) {
        if (isConflict(err)) return "exists";
        throw err;
      }
    },
    async update(key, patch) {
      await db.updateRow({ databaseId, tableId: usersTableId, rowId: key, data: patch });
    },
  };
}
