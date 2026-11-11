import { AccessKeyForm } from "./AccessKeyForm";
import { AlertCircleIcon } from "./icons";

interface Props {
  /** Why the server refused: no key on this device, or a wrong one. */
  message: string | null;
  onSave: (key: string) => void;
}

/** Shown when the cloud refuses this device. The planner keeps working locally meanwhile. */
export function AccessKeyBanner({ message, onSave }: Props) {
  return (
    <section
      role="region"
      aria-labelledby="access-key-title"
      className="mt-3 rounded-xl border-[1.5px] border-line bg-surface p-3 desk:p-4"
    >
      <div className="flex gap-2">
        <AlertCircleIcon size={18} className="mt-0.5 shrink-0 text-subtle" />
        <div className="min-w-0 flex-1">
          <h2 id="access-key-title" className="text-sm font-bold">
            Cloud sync is locked on this device
          </h2>
          <p className="mt-0.5 text-sm text-subtle">
            {message ?? "This device needs the access key."} Your changes are saved on this device and sync
            once the key is in.
          </p>
          <div className="mt-2 max-w-sm">
            <AccessKeyForm label="Access key" submitLabel="Unlock sync" onSave={onSave} />
          </div>
        </div>
      </div>
    </section>
  );
}
