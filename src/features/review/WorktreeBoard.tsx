import { ChevronDown, ChevronRight, GitBranch, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "@/lib/ipc/ipc";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useWorktreeStore } from "@/lib/stores/worktreeStore";

function shortPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || path;
}

/**
 * Parallel checkouts of the current repository, each openable as its own
 * project window — which is what gives it its own agent session, terminal and
 * checkpoint history.
 */
export default function WorktreeBoard() {
  const { t } = useTranslation();
  const projectPath = useProjectStore((s) => s.current?.path ?? null);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const loading = useWorktreeStore((s) => s.loading);
  const busy = useWorktreeStore((s) => s.busy);
  const error = useWorktreeStore((s) => s.error);
  const refresh = useWorktreeStore((s) => s.refresh);
  const create = useWorktreeStore((s) => s.create);
  const remove = useWorktreeStore((s) => s.remove);
  const reset = useWorktreeStore((s) => s.reset);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      reset();
      return;
    }
    if (!open) return;
    void refresh(projectPath);
  }, [open, projectPath, refresh, reset]);

  if (!projectPath) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    const created = await create(projectPath, trimmed);
    if (created) {
      setName("");
      void ipc.windowOpenProject(created.path);
    }
  };

  // Only the extra checkouts are actionable; the primary one is the window the
  // user is already in.
  const secondary = worktrees.filter((entry) => !entry.isPrimary);

  return (
    <section className="shrink-0 border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 w-full items-center gap-1.5 px-3 text-[11px] font-medium text-ink-2 hover:bg-hover"
      >
        {open ? (
          <ChevronDown className="size-3 text-ink-3" />
        ) : (
          <ChevronRight className="size-3 text-ink-3" />
        )}
        <GitBranch className="size-3 text-ink-3" />
        <span className="flex-1 text-left">{t("review.worktrees")}</span>
        {secondary.length > 0 && (
          <span className="font-mono text-[10px] text-ink-3">{secondary.length}</span>
        )}
      </button>

      {open && (
        <div className="px-3 pb-2.5">
          <p className="text-[10px] leading-relaxed text-ink-3">{t("review.worktreesHint")}</p>

          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              value={name}
              disabled={busy}
              spellCheck={false}
              placeholder={t("review.worktreeNamePlaceholder")}
              aria-label={t("review.worktreeName")}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void submit();
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-panel/60 px-2 font-mono text-[11px] text-ink outline-none focus:border-accent/70"
            />
            <button
              type="button"
              disabled={busy || name.trim().length === 0}
              onClick={() => void submit()}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line px-2 text-[10px] text-ink-2 hover:border-line-strong hover:text-ink disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
              {t("review.worktreeCreate")}
            </button>
          </div>

          {loading && (
            <div className="mt-2 text-[10px] text-ink-3">{t("review.worktreesLoading")}</div>
          )}
          {!loading && secondary.length === 0 && (
            <div className="mt-2 text-[10px] text-ink-3">{t("review.worktreesEmpty")}</div>
          )}

          <ul className="mt-1.5 space-y-1">
            {secondary.map((entry) => (
              <li
                key={entry.path}
                className="rounded-lg border border-line/70 bg-panel/40 px-2 py-1.5"
              >
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void ipc.windowOpenProject(entry.path)}
                    title={entry.path}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate font-mono text-[11px] text-ink-2">
                      {entry.branch ?? t("review.worktreeDetached")}
                    </span>
                    <span className="block truncate font-mono text-[9.5px] text-ink-3">
                      {shortPath(entry.path)}
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busy || entry.locked}
                    aria-label={t("review.worktreeRemove")}
                    title={
                      entry.locked ? t("review.worktreeLocked") : t("review.worktreeRemove")
                    }
                    onClick={() => setConfirming(entry.path)}
                    className="shrink-0 rounded p-1 text-ink-3 hover:bg-hover hover:text-danger disabled:opacity-40"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
                {confirming === entry.path && (
                  <div className="mt-1.5 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5">
                    <p className="text-[10px] leading-relaxed text-ink-2">
                      {t("review.worktreeRemoveConfirm", { path: shortPath(entry.path) })}
                    </p>
                    <div className="mt-1.5 flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="h-6 rounded-md border border-line px-2 text-[10px] text-ink-2"
                      >
                        {t("review.worktreeCancel")}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirming(null);
                          void remove(projectPath, entry.path);
                        }}
                        className="h-6 rounded-md border border-danger/40 px-2 text-[10px] text-danger disabled:opacity-40"
                      >
                        {t("review.worktreeRemove")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {error && <p className="mt-1.5 text-[10px] text-danger">{error}</p>}
        </div>
      )}
    </section>
  );
}
