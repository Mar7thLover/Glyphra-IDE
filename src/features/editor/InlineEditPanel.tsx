import { Check, CornerDownLeft, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export type InlineEditStatus = "input" | "running" | "preview";

export interface InlineEditPanelProps {
  x: number;
  y: number;
  status: InlineEditStatus;
  instruction: string;
  hint: string;
  error: string | null;
  onInstructionChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onDiscard: () => void;
}

/**
 * The Ctrl+K capsule: an instruction field over the target range, then
 * accept/discard controls once the agent's rewrite has been spliced in.
 */
export default function InlineEditPanel({
  x,
  y,
  status,
  instruction,
  hint,
  error,
  onInstructionChange,
  onSubmit,
  onCancel,
  onAccept,
  onDiscard,
}: InlineEditPanelProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (status === "input") inputRef.current?.focus();
  }, [status]);

  return (
    <div
      className="pointer-events-auto absolute z-30 w-[340px] max-w-[calc(100%-16px)]"
      style={{ left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (status === "preview") onDiscard();
          else onCancel();
        }
      }}
    >
      <div className="glass-float pop-in overflow-hidden rounded-xl border border-line/80 shadow-lg">
        <div className="flex items-center gap-1.5 border-b border-line/70 px-2.5 py-1.5">
          <Sparkles className="size-3 shrink-0 text-accent" />
          <span className="text-[10px] font-medium text-ink-2">
            {t("editor.inlineEdit")}
          </span>
          <span className="min-w-0 flex-1 truncate text-right font-mono text-[9.5px] text-ink-3">
            {hint}
          </span>
        </div>

        {status === "preview" ? (
          <div className="flex items-center gap-1.5 px-2.5 py-2">
            <button
              type="button"
              onClick={onAccept}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-line px-2 text-[10.5px] text-ink-2 hover:border-line-strong hover:text-ok"
            >
              <Check className="size-3" />
              {t("editor.inlineEditAccept")}
              <kbd className="ml-0.5 text-[9px] text-ink-3">Enter</kbd>
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-line px-2 text-[10.5px] text-ink-2 hover:border-line-strong hover:text-danger"
            >
              <X className="size-3" />
              {t("editor.inlineEditDiscard")}
              <kbd className="ml-0.5 text-[9px] text-ink-3">Esc</kbd>
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onSubmit}
              title={t("editor.inlineEditRetry")}
              className="inline-flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-hover hover:text-ink-2"
            >
              <RotateCcw className="size-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-2">
            <input
              ref={inputRef}
              value={instruction}
              disabled={status === "running"}
              placeholder={t("editor.inlineEditPlaceholder")}
              aria-label={t("editor.inlineEdit")}
              onChange={(event) => onInstructionChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  onSubmit();
                }
              }}
              className="h-6 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-[11px] text-ink outline-none placeholder:text-ink-3 focus:border-accent disabled:opacity-60"
            />
            <button
              type="button"
              onClick={status === "running" ? onCancel : onSubmit}
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-[10.5px] text-ink-2 hover:border-line-strong hover:text-ink"
            >
              {status === "running" ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  {t("editor.inlineEditCancel")}
                </>
              ) : (
                <>
                  <CornerDownLeft className="size-3" />
                  {t("editor.inlineEditRun")}
                </>
              )}
            </button>
          </div>
        )}

        {status === "running" && (
          <div className="px-2.5 pb-2 text-[10px] text-ink-3">
            {t("editor.inlineEditRunning")}
          </div>
        )}
        {error && (
          <div className="border-t border-line/70 px-2.5 py-1.5 text-[10px] text-danger">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
