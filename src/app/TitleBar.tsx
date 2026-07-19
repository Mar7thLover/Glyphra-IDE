import { useEffect, useState, type ReactNode } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowUpRight, Copy, Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useProjectStore } from "@/lib/stores/projectStore";
import { useUiStore } from "@/lib/stores/uiStore";

const win = getCurrentWindow();

function WinButton({
  danger,
  title,
  onClick,
  children,
}: {
  danger?: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex w-11 items-center justify-center text-ink-2 transition-colors duration-100 ${
        danger ? "hover:bg-[#e81123] hover:text-white" : "hover:bg-hover hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

export default function TitleBar() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);
  const agentOpen = useUiStore((s) => s.agentOpen);
  const toggleAgent = useUiStore((s) => s.toggleAgent);
  const openAgent = useUiStore((s) => s.openAgent);
  const projectName = useProjectStore((s) => s.current?.name);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="relative z-50 flex h-10 shrink-0 items-stretch border-b border-line bg-editor/40"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3.5 pr-2">
        <span className="pointer-events-none text-[11px] font-medium tracking-wide text-ink-2">
          {t("app.name")}
        </span>
      </div>

      {projectName ? (
        <div
          data-tauri-drag-region
          className="pointer-events-none flex flex-1 items-center justify-center"
        >
          <span className="truncate text-[11px] text-ink-3">{projectName}</span>
        </div>
      ) : (
        <div data-tauri-drag-region className="flex-1" />
      )}

      {/* Second Agent entry — titlebar pill, Cursor “Agents Window” energy. */}
      <div className="flex items-center pr-1">
        <button
          type="button"
          title={agentOpen ? t("agent.toggleHide") : t("agent.toggleShow")}
          onClick={() => (agentOpen ? toggleAgent() : openAgent())}
          className={`my-1.5 inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium transition-opacity ${
            agentOpen
              ? "bg-accent text-accent-ink"
              : "bg-accent/90 text-accent-ink hover:bg-accent"
          }`}
        >
          {t("agent.shortcutWindow")}
          <ArrowUpRight className="size-3" strokeWidth={2} />
        </button>
      </div>

      <div className="flex items-stretch">
        <WinButton title={t("titlebar.minimize")} onClick={() => void win.minimize()}>
          <Minus className="size-4" strokeWidth={1.5} />
        </WinButton>
        <WinButton
          title={maximized ? t("titlebar.restore") : t("titlebar.maximize")}
          onClick={() => void win.toggleMaximize()}
        >
          {maximized ? (
            <Copy className="size-3.5 -scale-x-100" strokeWidth={1.5} />
          ) : (
            <Square className="size-3.5" strokeWidth={1.5} />
          )}
        </WinButton>
        <WinButton danger title={t("titlebar.close")} onClick={() => void win.close()}>
          <X className="size-4" strokeWidth={1.5} />
        </WinButton>
      </div>
    </header>
  );
}
