import { History, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { SessionSummary } from "@/lib/acp/archive";

interface SessionListProps {
  archives: SessionSummary[];
  activeId: string | null;
  viewingId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatWhen(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

export default function SessionList({
  archives,
  activeId,
  viewingId,
  onOpen,
  onDelete,
}: SessionListProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title={t("agent.sessions")}
        onClick={() => setOpen((value) => !value)}
        className="grid size-6 place-items-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink"
      >
        <History className="size-3.5" strokeWidth={1.6} />
      </button>
      {open && (
        <div className="glass-float pop-in absolute left-0 top-full z-30 mt-1.5 w-64 overflow-hidden rounded-xl">
          <div className="border-b border-line px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
            {t("agent.sessions")}
          </div>
          {archives.length === 0 ? (
            <p className="px-2.5 py-3 text-[11px] text-ink-3">{t("agent.sessionsEmpty")}</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto py-1">
              {archives.map((archive) => {
                const selected = viewingId === archive.id || activeId === archive.id;
                return (
                  <li key={archive.id} className="group flex items-stretch">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpen(archive.id);
                      }}
                      className={`min-w-0 flex-1 px-2.5 py-1.5 text-left transition-colors hover:bg-hover ${
                        selected ? "bg-hover/80" : ""
                      }`}
                    >
                      <div className="truncate text-[11px] text-ink">{archive.title}</div>
                      <div className="mt-0.5 truncate text-[10px] text-ink-3">
                        {archive.backend} · {formatWhen(archive.updatedAt)} · {archive.itemCount}
                      </div>
                    </button>
                    <button
                      type="button"
                      title={t("agent.sessionDelete")}
                      onClick={() => onDelete(archive.id)}
                      className="px-2 text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    >
                      <Trash2 className="size-3" strokeWidth={1.6} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
