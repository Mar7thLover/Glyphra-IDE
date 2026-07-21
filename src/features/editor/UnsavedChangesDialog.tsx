import { FileWarning } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useUnsavedChangesStore } from "@/lib/unsavedChanges";

export default function UnsavedChangesDialog() {
  const { t } = useTranslation();
  const pending = useUnsavedChangesStore((s) => s.pending);
  const decide = useUnsavedChangesStore((s) => s.decide);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        decide("cancel");
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [decide, pending]);

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/25 p-6 backdrop-blur-[2px]">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        className="glass-float pop-in w-full max-w-[420px] rounded-2xl p-4"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-active text-ink-2">
            <FileWarning className="size-4.5" strokeWidth={1.6} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="unsaved-title" className="text-[13px] font-semibold text-ink">
              {t("editor.unsavedTitle")}
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-ink-3">
              {t("editor.unsavedBody", { name: pending.name })}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={() => decide("cancel")}
            className="h-8 rounded-lg px-3 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
          >
            {t("editor.cancelLeave")}
          </button>
          <button
            type="button"
            onClick={() => decide("discard")}
            className="h-8 rounded-lg border border-danger/25 px-3 text-[11px] text-danger hover:bg-danger/10"
          >
            {t("editor.discardAndLeave")}
          </button>
          <button
            type="button"
            onClick={() => decide("save")}
            className="btn-accent h-8 rounded-lg px-3 text-[11px] font-medium"
          >
            {t("editor.saveAndLeave")}
          </button>
        </div>
      </section>
    </div>
  );
}
