"use client";

import { useCallback, useEffect, useState } from "react";
import { SECTION } from "@/lib/config";
import {
  LOCAL_ACCOUNT,
  lastAccount,
  rememberAccount,
  signIn,
  signOut,
  signUp,
  whoAmI,
  type Account,
} from "@/lib/account";
import { loadLocalCache, loadPreAccountsCache } from "@/lib/localCache";
import { loadRemoteState } from "@/lib/remote";
import { readLegacy, type AppState } from "@/lib/storage";
import { Planner } from "./Planner";

type Gate =
  | { type: "checking" }
  | { type: "signIn"; notice: string | null; notConfigured: boolean }
  /** This device has a planner from before accounts: ask whether it is this person's. */
  | { type: "move"; account: Account; pre: AppState }
  | { type: "open"; account: Account; preAccounts: AppState | null };

/** The planner this device had before sign-in existed, if any. */
async function preAccountsState(): Promise<AppState | null> {
  const cached = await loadPreAccountsCache();
  if (cached) return cached.state;
  try {
    return readLegacy(window.localStorage)?.state ?? null;
  } catch {
    return null;
  }
}

export function AuthGate() {
  const [gate, setGate] = useState<Gate>({ type: "checking" });

  const enter = useCallback(async (account: Account) => {
    if (account.key !== LOCAL_ACCOUNT.key) rememberAccount(account);
    // Someone who already has a planner on this device is never asked.
    const own = await loadLocalCache(account.key);
    const pre = own ? null : await preAccountsState();
    // Nor is someone whose account already has a planner in the cloud.
    const remote = pre && account.key !== LOCAL_ACCOUNT.key ? await loadRemoteState() : null;
    const hasCloudCopy = remote?.type === "ok" && remote.record !== null;
    setGate(pre && !hasCloudCopy ? { type: "move", account, pre } : { type: "open", account, preAccounts: null });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void whoAmI().then((who) => {
      if (cancelled) return;
      if (who.type === "signedIn") return void enter(who.account);
      if (who.type === "signedOut") return setGate({ type: "signIn", notice: null, notConfigured: false });
      if (who.type === "notConfigured") return setGate({ type: "signIn", notice: who.message, notConfigured: true });
      // Offline: open the last account from this device's copy.
      const last = lastAccount();
      if (last) setGate({ type: "open", account: last, preAccounts: null });
      else setGate({ type: "signIn", notice: "No connection to the server. Sign in once you are online.", notConfigured: false });
    });
    return () => {
      cancelled = true;
    };
  }, [enter]);

  const leave = useCallback(async () => {
    await signOut();
    setGate({ type: "signIn", notice: null, notConfigured: false });
  }, []);

  switch (gate.type) {
    case "checking":
      return <div className="mx-auto mt-16 h-64 max-w-md rounded-xl bg-muted" role="status" aria-label="Loading" />;
    case "signIn":
      return (
        <SignIn
          notice={gate.notice}
          notConfigured={gate.notConfigured}
          onSignedIn={(account) => void enter(account)}
          onLocal={() => void enter(LOCAL_ACCOUNT)}
        />
      );
    case "move":
      return (
        <MovePrompt
          account={gate.account}
          onAnswer={(move) => setGate({ type: "open", account: gate.account, preAccounts: move ? gate.pre : null })}
        />
      );
    case "open":
      return (
        <Planner
          key={gate.account.key}
          account={gate.account}
          preAccounts={gate.preAccounts}
          onSignOut={gate.account.key === LOCAL_ACCOUNT.key ? null : () => void leave()}
          onSignInAgain={() => setGate({ type: "signIn", notice: "Your session ended. Sign in again to sync.", notConfigured: false })}
        />
      );
  }
}

const inputCls =
  "mt-1 min-h-11 w-full rounded-lg border-[1.5px] border-field bg-surface px-3 py-2 text-base font-normal text-ink";

function SignIn({
  notice,
  notConfigured,
  onSignedIn,
  onLocal,
}: {
  notice: string | null;
  notConfigured: boolean;
  onSignedIn: (account: Account) => void;
  onLocal: () => void;
}) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Enter your name (at least 2 letters).");
    if (!/^\d{4,6}$/.test(pin)) return setError("The PIN is 4 to 6 digits.");
    setBusy(true);
    const result = await (mode === "in" ? signIn : signUp)(name.trim(), pin);
    setBusy(false);
    if (result.ok) onSignedIn(result.account);
    else setError(result.message);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <h1 className="font-display text-4xl font-bold">Skip planner</h1>
      <p className="mt-1 text-sm text-subtle">
        {SECTION}. Upload your attendance once and see which classes you can skip while staying above 75%.
      </p>

      {notConfigured ? (
        <div className="mt-6 rounded-xl border border-line bg-surface p-4">
          <p className="text-sm">{notice}</p>
          <p className="mt-1 text-sm text-subtle">You can still use the planner; it is kept on this device only.</p>
          <button type="button" onClick={onLocal} className="mt-3 min-h-11 w-full rounded-lg bg-ink px-4 text-sm font-bold text-page">
            Use on this device
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 rounded-xl border border-line bg-surface p-4" noValidate>
          <div role="tablist" aria-label="Sign in or create an account" className="grid grid-cols-2 rounded-lg bg-empty p-0.5">
            {(["in", "up"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`min-h-10 rounded-md text-sm font-semibold ${mode === m ? "bg-teal text-white" : "text-ink"}`}
              >
                {m === "in" ? "Sign in" : "New here"}
              </button>
            ))}
          </div>
          {notice && <p className="mt-3 text-sm font-semibold">{notice}</p>}
          <label className="mt-4 block text-sm font-bold">
            Name
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="words"
              maxLength={24}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="mt-3 block text-sm font-bold">
            PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className={`${inputCls} tracking-[0.3em]`}
            />
          </label>
          <p className="mt-1 text-xs text-subtle">
            {mode === "in"
              ? "The name and PIN you picked the first time."
              : "Pick the name your friends know you by and a 4 to 6 digit PIN. There is no PIN reset, so remember it."}
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-must-border">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 min-h-11 w-full rounded-lg bg-ink px-4 text-sm font-bold text-page disabled:opacity-60"
          >
            {busy ? "One moment…" : mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>
      )}
    </main>
  );
}

function MovePrompt({ account, onAnswer }: { account: Account; onAnswer: (move: boolean) => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Is this your planner?</h1>
      <p className="mt-2 text-sm">
        This device has a planner from before sign-in, with its own record, marks and ODs. Move it into{" "}
        <strong>{account.name}</strong>&rsquo;s account?
      </p>
      <p className="mt-1 text-sm text-subtle">
        If it belongs to someone else, start fresh: you will upload your own attendance next.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <button type="button" onClick={() => onAnswer(true)} className="min-h-11 rounded-lg bg-ink px-4 text-sm font-bold text-page">
          Yes, move it into my account
        </button>
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className="min-h-11 rounded-lg border-[1.5px] border-line bg-surface px-4 text-sm font-semibold hover:border-teal"
        >
          No, start fresh
        </button>
      </div>
    </main>
  );
}
