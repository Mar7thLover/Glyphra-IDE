import { Search } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import FilePanel from "@/features/tree/FilePanel";
import { useUiStore, type Panel } from "@/lib/stores/uiStore";

export const SIDEBAR_WIDTH = 268;

function Placeholder(_props: { panel: Extract<Panel, "search"> }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-xs text-ink-3">
      <div className="grid size-10 place-items-center rounded-xl border border-line bg-raised/50 text-ink-2">
        <Search className="size-5" strokeWidth={1.6} />
      </div>
      <p>{t("panel.comingSoon")}</p>
    </div>
  );
}

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
            {t(`panel.${panel}`)}
          </div>
        )}
        {panel === "files" && <FilePanel />}
        {panel === "search" && <Placeholder panel={panel} />}
      </div>
    </motion.aside>
  );
}
