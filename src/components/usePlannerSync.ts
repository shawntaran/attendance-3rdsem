"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearAccessKey, setAccessKey } from "@/lib/accessKey";
import { localCache } from "@/lib/localCache";
import { remoteApi, saveRemoteStateOnExit } from "@/lib/remote";
import { clearLegacy, defaultState, readLegacy, type AppState } from "@/lib/storage";
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
export function usePlannerSync() {
  const engineRef = useRef<SyncEngine | null>(null);
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(INITIAL);

  useEffect(() => {
    const engine = new SyncEngine({
      remote: remoteApi,
      cache: localCache,
      legacy: {
        read: () => readLegacy(window.localStorage),
        clear: () => clearLegacy(window.localStorage),
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
  }, []);

  const update = useCallback((state: AppState) => engineRef.current?.update(state), []);
  const resolveConflict = useCallback((choice: "cloud" | "device") => engineRef.current?.resolveConflict(choice), []);
  const retry = useCallback(() => engineRef.current?.syncNow(), []);
  /** Save this device's access key and sync straight away. */
  const saveAccessKey = useCallback((key: string) => {
    setAccessKey(key);
    return engineRef.current?.syncNow();
  }, []);
  const forgetAccessKey = useCallback(() => {
    clearAccessKey();
    return engineRef.current?.syncNow();
  }, []);

  return { ...snapshot, update, resolveConflict, retry, saveAccessKey, forgetAccessKey };
}
