"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Account } from "@/lib/account";
import { clearPreAccountsCache, localCacheFor } from "@/lib/localCache";
import { remoteApi, saveRemoteStateOnExit } from "@/lib/remote";
import { clearLegacy, defaultState, type AppState } from "@/lib/storage";
import { SyncEngine, type SyncSnapshot } from "@/lib/sync";

/** How often an open, visible tab checks the cloud for changes from other devices. */
const POLL_MS = 15_000;

const INITIAL: SyncSnapshot = {
  ready: false,
  state: defaultState(),
  status: "connecting",
  message: null,
  failureKind: null,
  conflict: null,
  remoteRevision: 0,
};

/**
 * The planner state, kept in sync with the cloud. Edits go through `update`;
 * changes from other devices arrive in `state` (and bump `remoteRevision`).
 *
 * Other devices' changes are picked up by polling while the tab is visible,
 * and at once when the tab becomes visible, the window gets focus or the
 * network comes back. Pending edits are sent when the tab is hidden or closed.
 */
export function usePlannerSync(account: Account, preAccounts: AppState | null) {
  const engineRef = useRef<SyncEngine | null>(null);
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(INITIAL);
  // Read once per mount: the choice to move this device's old planner is made before.
  const moveRef = useRef(preAccounts);

  useEffect(() => {
    const moving = moveRef.current;
    const engine = new SyncEngine({
      remote: remoteApi,
      cache: localCacheFor(account.key),
      // This device's planner from before accounts, only if the person chose to
      // move it into their account. It is cleared once the cloud copy is verified.
      legacy: {
        read: () => (moving ? { state: moving, key: "pre-accounts" } : null),
        clear: () => {
          clearLegacy(window.localStorage);
          void clearPreAccountsCache();
        },
      },
    });
    engineRef.current = engine;
    const unsubscribe = engine.subscribe(setSnapshot);
    void engine.start();

    const visible = () => document.visibilityState === "visible";
    const poll = window.setInterval(() => {
      if (visible() && navigator.onLine) void engine.syncNow();
    }, POLL_MS);
    const onVisibility = () => {
      if (visible()) void engine.syncNow();
      else void engine.flush();
    };
    const onWake = () => void engine.syncNow();
    const onPageHide = () => {
      const rec = engine.getRecord();
      if (rec.pending) saveRemoteStateOnExit(rec.state, rec.baseVersion);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pagehide", onPageHide);
      unsubscribe();
      engine.dispose();
      engineRef.current = null;
    };
  }, [account.key]);

  const update = useCallback((state: AppState) => engineRef.current?.update(state), []);
  const resolveConflict = useCallback((choice: "cloud" | "device") => engineRef.current?.resolveConflict(choice), []);
  const retry = useCallback(() => engineRef.current?.syncNow(), []);

  return { ...snapshot, update, resolveConflict, retry };
}
