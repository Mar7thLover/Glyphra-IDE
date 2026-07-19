import { Files, Search, Settings, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { useUiStore, type Panel } from "@/lib/stores/uiStore";

const mainItems: { id: Panel; icon: LucideIcon }[] = [
  { id: "files", icon: Files },
  { id: "search", icon: Search },
];

function RailButton({ id, icon: Icon }: { id: Panel; icon: LucideIcon }) {
  const { t } = useTranslation();
  const active = useUiStore((s) => s.activePanel === id && s.sidebarOpen);
  const toggle = useUiStore((s) => s.togglePanel);

  return (
    <button
      title={t(`rail.${id}`)}
      onClick={() => toggle(id)}
      className={`relative flex h-11 w-full items-center justify-center transition-colors duration-100 ${
        active ? "text-ink" : "text-ink-3 hover:text-ink-2"
      }`}
    >
      {active && (
        <motion.span
          layoutId="rail-indicator"
          className="absolute left-0 top-3 h-5 w-[2.5px] rounded-full bg-accent"
          transition={{ type: "spring", stiffness: 520, damping: 42 }}
        />
      )}
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </button>
  );
}

export default function ActivityRail() {
  const { t } = useTranslation();
  const openSettings = useUiStore((s) => s.openSettings);

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center border-r border-line bg-panel pt-1">
      {mainItems.map((item) => (
        <RailButton key={item.id} {...item} />
      ))}
      <div className="flex-1" />
      <button
        type="button"
        title={t("rail.settings")}
        onClick={openSettings}
        className="flex h-11 w-full items-center justify-center text-ink-3 transition-colors hover:text-ink-2"
      >
        <Settings className="size-[18px]" strokeWidth={1.75} />
      </button>
      <div className="h-1.5" />
    </nav>
  );
}
