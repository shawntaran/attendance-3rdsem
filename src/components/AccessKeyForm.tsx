"use client";

import { useState } from "react";

interface Props {
  onSave: (key: string) => void;
  /** Field label; the banner and the settings drawer word it differently. */
  label: string;
  submitLabel: string;
  inputCls?: string;
}

/** A password field for the cloud access key. The key is never shown back. */
export function AccessKeyForm({ onSave, label, submitLabel, inputCls }: Props) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const trimmed = value.trim();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed) return;
        onSave(trimmed);
        setValue("");
      }}
    >
      <label className="text-xs font-semibold">
        {label}
        <input
          type={show ? "text" : "password"}
          value={value}
          autoComplete="current-password"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          className={
            inputCls ??
            "mt-1 min-h-11 w-full rounded-lg border-[1.5px] border-field bg-surface px-2.5 py-2 text-sm text-ink"
          }
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={!trimmed}
          className="min-h-11 rounded-lg bg-ink px-4 text-sm font-bold text-page disabled:bg-muted disabled:text-subtle"
        >
          {submitLabel}
        </button>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 accent-teal" />
          Show key
        </label>
      </div>
    </form>
  );
}
