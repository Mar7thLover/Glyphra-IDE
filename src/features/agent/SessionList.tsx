import { History, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { sessionLabel, type SessionSummary } from "@/lib/acp/archive";
import type { AgentSessionHandle } from "@/lib/acp/bus";
import { useAgentStore } from "@/lib/stores/agentStore";

import SessionTitleInput from "./SessionTitleInput";

interface SessionListProps {
  archives: SessionSummary[];
  liveSessions: AgentSessionHandle[];
  activeId: string | null;
  viewingId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onSwitchLive: (id: string) => void;
  onCloseLive: (id: string) => void;
  onRename: (id: string, title: string) => void;
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
  liveSessions,
  activeId,
  viewingId,
  onOpen,
  onDelete,
  onSwitchLive,
  onCloseLive,
  onRename,
}: SessionListProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const sessionTitles = useAgentStore((state) => state.sessionTitles);
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
        className="relative grid size-6 place-items-center rounded-md text-ink-3 transition-colors hover:bg-hover hover:text-ink"
      >
        <History className="size-3.5" strokeWidth={1.6} />
        {liveSessions.some((session) => session.status === "busy") && (
          <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent status-pulse" />
        )}
      </button>
      {open && (
        <div className="glass-float pop-in absolute left-0 top-full z-30 mt-1.5 w-64 overflow-hidden rounded-xl">
          <div className="border-b border-line px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
            {t("agent.sessions")}
          </div>
          {liveSessions.length > 0 && (
            <>
              <div className="px-2.5 pb-1 pt-2 text-[9px] font-medium uppercase tracking-wide text-ink-3">
                {t("agent.liveSessions")}
              </div>
              <ul className="border-b border-line pb-1">
                {liveSessions.map((session) => {
                  const label = sessionLabel(
                    session.items,
                    sessionTitles[session.archiveId],
                    session.agentName ??
                      session.acpSessionId?.slice(0, 8) ??
                      session.backend,
                  );
                  return (
                  <li key={session.archiveId} className="group flex items-stretch">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onSwitchLive(session.archiveId);
                      }}
                      onDoubleClick={() => setRenamingId(session.archiveId)}
                      className={`min-w-0 flex-1 px-2.5 py-1.5 text-left transition-colors hover:bg-hover ${
                        activeId === session.archiveId ? "bg-hover/80" : ""
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`size-1.5 shrink-0 rounded-full ${
                            session.status === "busy"
                              ? "status-pulse bg-accent"
                              : session.status === "crashed"
                                ? "bg-danger"
                                : "bg-ok"
                          }`}
                        />
                        {renamingId === session.archiveId ? (
                          <SessionTitleInput
                            initial={label}
                            onCommit={(title) => {
                              setRenamingId(null);
                              onRename(session.archiveId, title);
                            }}
                            onCancel={() => setRenamingId(null)}
                          />
                        ) : (
                          <span className="truncate text-[11px] text-ink">{label}</span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate pl-3 text-[10px] text-ink-3">
                        {session.backend} ·{" "}
                        {session.status === "busy"
                          ? t("agent.statusBusy")
                          : session.status === "crashed"
                            ? t("agent.statusCrashed")
                            : t("agent.statusLive")}
                      </div>
                    </button>
                    <button
                      type="button"
                      title={t("agent.sessionRename")}
                      onClick={() => setRenamingId(session.archiveId)}
                      className="pl-1.5 text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                    >
                      <Pencil className="size-3" strokeWidth={1.6} />
                    </button>
                    <button
                      type="button"
                      title={t("agent.stop")}
                      onClick={() => onCloseLive(session.archiveId)}
                      className="px-1.5 text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    >
                      <X className="size-3" strokeWidth={1.6} />
                    </button>
                  </li>
                  );
                })}
              </ul>
            </>
          )}
          {archives.length === 0 && liveSessions.length === 0 ? (
            <p className="px-2.5 py-3 text-[11px] text-ink-3">{t("agent.sessionsEmpty")}</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto py-1">
              {archives
                .filter(
                  (archive) =>
                    !liveSessions.some((session) => session.archiveId === archive.id),
                )
                .map((archive) => {
                const selected = viewingId === archive.id || activeId === archive.id;
                return (
                  <li key={archive.id} className="group flex items-stretch">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onOpen(archive.id);
                      }}
                      onDoubleClick={() => setRenamingId(archive.id)}
                      className={`min-w-0 flex-1 px-2.5 py-1.5 text-left transition-colors hover:bg-hover ${
                        selected ? "bg-hover/80" : ""
                      }`}
                    >
                      {renamingId === archive.id ? (
                        <SessionTitleInput
                          initial={archive.title}
                          onCommit={(title) => {
                            setRenamingId(null);
                            onRename(archive.id, title);
                          }}
                          onCancel={() => setRenamingId(null)}
                        />
                      ) : (
                        <div className="truncate text-[11px] text-ink">{archive.title}</div>
                      )}
                      <div className="mt-0.5 truncate text-[10px] text-ink-3">
                        {archive.backend} · {formatWhen(archive.updatedAt)} · {archive.itemCount}
                      </div>
                    </button>
                    <button
                      type="button"
                      title={t("agent.sessionRename")}
                      onClick={() => setRenamingId(archive.id)}
                      className="pl-1.5 text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                    >
                      <Pencil className="size-3" strokeWidth={1.6} />
                    </button>
                    <button
                      type="button"
                      title={t("agent.sessionDelete")}
                      onClick={() => onDelete(archive.id)}
                      className="px-1.5 text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
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
