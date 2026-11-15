import { formatDate } from "@/lib/dates";

interface Props {
  count: number;
  /** Date of the earliest past class with no mark. */
  firstDate: string;
  onShow: () => void;
}

/** Past classes waiting for a mark. They are not counted until marked. */
export function UnmarkedNotice({ count, firstDate, onShow }: Props) {
  return (
    <section
      aria-labelledby="unmarked-title"
      className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border-[1.5px] border-dashed border-field bg-surface px-3 py-2 desk:px-4"
    >
      <div className="min-w-0 flex-1">
        <h2 id="unmarked-title" className="text-sm font-bold">
          {count} past {count === 1 ? "class is" : "classes are"} not marked
        </h2>
        <p className="text-xs text-subtle">
          Tap each one to say whether you went. Until then they are left out of your current %, and the
          plan counts them as missed, so marking them attended can free up skips.
        </p>
      </div>
      <button
        type="button"
        onClick={onShow}
        className="min-h-11 shrink-0 rounded-lg border-[1.5px] border-line px-3 text-sm font-semibold hover:border-teal"
      >
        Show the first ({formatDate(firstDate)})
      </button>
    </section>
  );
}
