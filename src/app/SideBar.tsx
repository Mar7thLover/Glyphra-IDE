import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import SearchPanel from "@/features/search/SearchPanel";
import FilePanel from "@/features/tree/FilePanel";
import { useUiStore, type Panel } from "@/lib/stores/uiStore";

export const SIDEBAR_WIDTH = 268;

/** Left sidebar: explorer / search only. Settings is a separate page. */
export default function SideBar() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.sidebarOpen);
  const panel = useUiStore((s) => s.activePanel);

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? SIDEBAR_WIDTH : 0 }}
      transition={{ type: "spring", stiffness: 480, damping: 44 }}
      className="relative shrink-0 overflow-hidden bg-panel"
      style={{ borderRight: open ? "1px solid var(--line)" : "none" }}
    >
      <div className="flex h-full flex-col" style={{ width: SIDEBAR_WIDTH }}>
        {panel !== "files" && (
          <div className="flex h-9 shrink-0 items-center px-3 text-[11px] font-medium text-ink-3">
            {t(`panel.${panel}` as `panel.${Panel}`)}
          </div>
        )}
        {panel === "files" && <FilePanel />}
        {panel === "search" && <SearchPanel />}
      </div>
    </motion.aside>
  );
}
