import type { SyncStatus } from "@/lib/sync";

const LABEL: Record<SyncStatus, string> = {
  connecting: "Connecting…",
  synced: "Cloud synced",
  saving: "Saving...",
  pending: "Sync pending",
  offline: "Offline",
  error: "Sync error",
};

const DETAIL: Record<SyncStatus, string> = {
  connecting: "Loading the latest copy from the cloud.",
  synced: "All changes are saved in the cloud.",
  saving: "Saving your changes to the cloud.",
  pending: "Changes are saved on this device and will be sent to the cloud.",
  offline: "No connection. Changes are saved on this device and will sync when you are back online.",
  error: "Changes are saved on this device but could not be sent to the cloud.",
};

const DOT: Record<SyncStatus, string> = {
  connecting: "bg-field",
  synced: "bg-ok-border",
  saving: "bg-done-border animate-pulse motion-reduce:animate-none",
  pending: "bg-skipped-border",
  offline: "bg-skipped-border",
  error: "bg-must-border",
};

interface Props {
  status: SyncStatus;
  message: string | null;
  onRetry: () => void;
}

/** A small status pill. Errors and offline turn it into a retry button. */
export function SyncIndicator({ status, message, onRetry }: Props) {
  const detail = message && (status === "error" || status === "offline") ? `${DETAIL[status]} ${message}` : DETAIL[status];
  const canRetry = status === "error" || status === "offline";
  const content = (
    <>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} />
      <span className="whitespace-nowrap">{LABEL[status]}</span>
    </>
  );
  const cls = "inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-subtle";
  return (
    <span role="status" aria-live="polite" className="inline-flex">
      {canRetry ? (
        <button
          type="button"
          onClick={onRetry}
          title={`${detail} Tap to retry.`}
          aria-label={`${LABEL[status]}. ${detail} Retry now.`}
          className={`${cls} border border-line bg-surface hover:border-teal`}
        >
          {content}
        </button>
      ) : (
        <span title={detail} aria-label={`${LABEL[status]}. ${detail}`} className={cls}>
          {content}
        </span>
      )}
    </span>
  );
}
