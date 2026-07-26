import { Loader2, Pencil, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { LspLocation } from "@/lib/ipc/ipc";

function displayPath(projectPath: string | null, path: string) {
  if (!projectPath) return path;
  const root = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalized = path.replace(/\\/g, "/");
  return normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
}

export interface LspLocationsPanelProps {
  kind: "definition" | "references";
  items: LspLocation[];
  projectPath: string | null;
  onPick: (location: LspLocation) => void;
  onClose: () => void;
}

/**
 * Result list for go-to-definition (when a symbol resolves to more than one
 * place) and find-references. Anchored bottom-right so it never covers the
 * caret the user just navigated from.
 */
export function LspLocationsPanel({
  kind,
  items,
  projectPath,
  onPick,
  onClose,
}: LspLocationsPanelProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.querySelector("button")?.focus();
  }, [items]);

  return (
    <div
      ref={listRef}
      className="pointer-events-auto absolute bottom-3 right-3 z-30 w-[380px] max-w-[calc(100%-24px)]"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="glass-float pop-in overflow-hidden rounded-xl border border-line/80 shadow-lg">
        <div className="flex items-center gap-2 border-b border-line/70 px-2.5 py-1.5">
          <span className="flex-1 truncate text-[11px] font-medium text-ink-2">
            {kind === "definition"
              ? t("lsp.definitions", { n: items.length })
              : t("lsp.references", { n: items.length })}
          </span>
          <button
            type="button"
            aria-label={t("lsp.close")}
            className="rounded p-0.5 text-ink-3 hover:bg-hover hover:text-ink-2"
            onClick={onClose}
          >
            <X className="size-3" />
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto py-1">
          {items.map((item, index) => (
            <button
              key={`${item.path}:${item.line}:${item.column}:${index}`}
              type="button"
              className="flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-hover"
              onClick={() => onPick(item)}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">
                {displayPath(projectPath, item.path)}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-ink-3">
                {item.line}:{item.column}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface LspRenamePanelProps {
  value: string;
  busy: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/** Symbol rename prompt. Edits land as unsaved buffers the user can review. */
export function LspRenamePanel({
  value,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel,
}: LspRenamePanelProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-3 z-30 w-[320px] max-w-[calc(100%-16px)] -translate-x-1/2"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
        if (event.key === "Enter" && !busy) {
          event.preventDefault();
          event.stopPropagation();
          onSubmit();
        }
      }}
    >
      <div className="glass-float pop-in overflow-hidden rounded-xl border border-line/80 shadow-lg">
        <div className="flex items-center gap-1.5 border-b border-line/70 px-2.5 py-1.5">
          <Pencil className="size-3 shrink-0 text-accent" />
          <span className="flex-1 truncate text-[11px] font-medium text-ink-2">
            {t("lsp.renameTitle")}
          </span>
          {busy && <Loader2 className="size-3 animate-spin text-ink-3" />}
        </div>
        <div className="px-2.5 py-2">
          <input
            ref={inputRef}
            value={value}
            disabled={busy}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
            className="w-full rounded-md border border-line/80 bg-panel/60 px-2 py-1 font-mono text-[12px] text-ink-1 outline-none focus:border-accent/70"
          />
          <p className="mt-1 text-[10px] text-ink-3">{t("lsp.renameHint")}</p>
          {error && <p className="mt-1 text-[10px] text-danger">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export interface LspNoticeProps {
  message: string;
  onClose: () => void;
}

export function LspNotice({ message, onClose }: LspNoticeProps) {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-auto absolute bottom-3 right-3 z-20 max-w-[calc(100%-24px)]">
      <div className="glass-float pop-in flex items-center gap-2 rounded-full border border-line/80 px-3 py-1 shadow-sm">
        <span className="truncate text-[11px] text-ink-2">{message}</span>
        <button
          type="button"
          aria-label={t("lsp.close")}
          className="rounded p-0.5 text-ink-3 hover:bg-hover hover:text-ink-2"
          onClick={onClose}
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}
