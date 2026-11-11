import { describePath } from "@/lib/merge";
import type { SyncConflict } from "@/lib/sync";
import { AlertCircleIcon } from "./icons";

interface Props {
  conflict: SyncConflict;
  onResolve: (choice: "cloud" | "device") => void;
}

/** Save this device's copy as a JSON file, so nothing is lost whichever way the person chooses. */
function downloadCopy(conflict: SyncConflict) {
  const blob = new Blob([JSON.stringify(conflict.local, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `skip-planner-this-device-${conflict.at.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ConflictBanner({ conflict, onResolve }: Props) {
  const initial = conflict.kind === "initial";
  const count = initial ? 0 : conflict.conflicts.length;
  const title = initial
    ? "This device has different data from the cloud"
    : `${count} ${count === 1 ? "change" : "changes"} clashed with another device`;
  const body = initial
    ? "You are seeing the cloud copy. This device's copy is kept until you choose which one to use."
    : "The other device's values are in use for these. Everything else from both devices was merged.";
  const deviceLabel = initial ? "Use this device's copy" : "Use this device's values";

  return (
    <section
      role="region"
      aria-labelledby="conflict-title"
      className="mt-3 rounded-xl border-[1.5px] border-skipped-border bg-skipped-bg p-3 text-skipped-ink desk:p-4"
    >
      <div className="flex gap-2">
        <AlertCircleIcon size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id="conflict-title" className="text-sm font-bold">
            {title}
          </h2>
          <p className="mt-0.5 text-sm">{body}</p>
          {!initial && count > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs">
              {conflict.conflicts.slice(0, 5).map((c) => (
                <li key={c.path}>{describePath(c.path)}</li>
              ))}
              {count > 5 && <li>and {count - 5} more</li>}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onResolve("cloud")}
              className="min-h-11 rounded-lg bg-ink px-3 text-sm font-bold text-page hover:opacity-90"
            >
              Keep the cloud copy
            </button>
            <button
              type="button"
              onClick={() => onResolve("device")}
              className="min-h-11 rounded-lg border-[1.5px] border-current bg-transparent px-3 text-sm font-bold"
            >
              {deviceLabel}
            </button>
            <button
              type="button"
              onClick={() => downloadCopy(conflict)}
              className="min-h-11 rounded-lg px-3 text-sm font-semibold underline underline-offset-2"
            >
              Download this device&rsquo;s copy
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
