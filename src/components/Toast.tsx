import { CloseIcon } from "./icons";

export interface ToastData {
  key: number;
  message: string;
  canUndo: boolean;
}

interface Props {
  toast: ToastData | null;
  onUndo: () => void;
  onDismiss: () => void;
}

export function Toast({ toast, onUndo, onDismiss }: Props) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      role="status"
      aria-live="polite"
    >
      {toast && (
        <div
          key={toast.key}
          className="anim-sheet pointer-events-auto flex w-full max-w-xl items-center gap-1 rounded-xl bg-raised py-1.5 pr-1.5 pl-4 text-sm text-white shadow-[0_8px_30px_rgb(20_32_43/0.35)]"
        >
          <p className="min-w-0 flex-1 py-1.5 leading-snug">{toast.message}</p>
          {toast.canUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="min-h-11 shrink-0 rounded-lg px-3 font-bold text-today hover:bg-white/10 focus-visible:outline-white focus-visible:shadow-none"
            >
              Undo
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-white/10 focus-visible:outline-white focus-visible:shadow-none"
          >
            <CloseIcon size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
