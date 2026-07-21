import { FileDiff, Files, Search, Settings, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { useUiStore, type Panel } from "@/lib/stores/uiStore";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useGitStore } from "@/lib/stores/gitStore";

const mainItems: { id: Panel; icon: LucideIcon }[] = [
  { id: "files", icon: Files },
  { id: "search", icon: Search },
];

function RailButton({ id, icon: Icon }: { id: Panel; icon: LucideIcon }) {
  const { t } = useTranslation();
  const active = useUiStore(
    (s) => s.workspaceView === "editor" && s.activePanel === id && s.sidebarOpen,
  );
  const toggle = useUiStore((s) => s.togglePanel);

  return (
    <button
      title={t(`rail.${id}`)}
      onClick={() => toggle(id)}
      className={`relative grid size-9 place-items-center rounded-[10px] transition-colors duration-100 ${
        active ? "text-ink" : "text-ink-3 hover:text-ink-2"
      }`}
    >
      {active && (
        <motion.span
          layoutId="rail-active"
          className="absolute inset-0 rounded-[10px] bg-active shadow-[var(--shadow-soft)]"
          transition={{ type: "spring", stiffness: 520, damping: 42 }}
        />
      )}
      <Icon className="relative size-[17px]" strokeWidth={1.75} />
    </button>
  );
}

export default function ActivityRail() {
  const { t } = useTranslation();
  const openSettings = useUiStore((s) => s.openSettings);
  const reviewActive = useUiStore((s) => s.workspaceView === "git-review");
  const showWorkspace = useUiStore((s) => s.showWorkspace);
  const changeCount = useGitStore((s) => Object.keys(s.statuses).length);

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 pt-1.5">
      {mainItems.map((item) => (
        <RailButton key={item.id} {...item} />
      ))}
      <button
        type="button"
        title={t("rail.gitReview")}
        onClick={() => {
          if (reviewActive) {
            showWorkspace("editor");
            return;
          }
          void useEditorStore.getState().confirmLeaveActive().then((leave) => {
            if (leave) showWorkspace("git-review");
          });
        }}
        className={`relative grid size-9 place-items-center rounded-[10px] transition-colors duration-100 ${
          reviewActive ? "text-ink" : "text-ink-3 hover:text-ink-2"
        }`}
      >
        {reviewActive && (
          <motion.span
            layoutId="rail-active"
            className="absolute inset-0 rounded-[10px] bg-active shadow-[var(--shadow-soft)]"
            transition={{ type: "spring", stiffness: 520, damping: 42 }}
          />
        )}
        <FileDiff className="relative size-[17px]" strokeWidth={1.75} />
        {changeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-accent px-1 text-center font-mono text-[8px] leading-3.5 text-accent-ink">
            {changeCount > 99 ? "99+" : changeCount}
          </span>
        )}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        title={t("rail.settings")}
        onClick={() => openSettings()}
        className="grid size-9 place-items-center rounded-[10px] text-ink-3 transition-colors hover:bg-hover hover:text-ink-2"
      >
        <Settings className="size-[17px]" strokeWidth={1.75} />
      </button>
      <div className="h-2" />
    </nav>
  );
}
