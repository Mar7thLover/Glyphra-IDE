import { useEffect, useState, type ReactNode } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bot, Copy, Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

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
      className="relative z-50 flex h-10 shrink-0 items-stretch border-b border-line"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3.5 pr-2">
        <div className="pointer-events-none size-3.5 rounded-[5px] bg-accent" />
        <span className="pointer-events-none text-xs font-semibold tracking-wide text-ink-2">
          {t("app.name")}
        </span>
      </div>
      <div data-tauri-drag-region className="flex-1" />

      {/* Second Agent entry: titlebar quick launch (right of drag region). */}
      <div className="flex items-stretch pr-1">
        <button
          type="button"
          title={agentOpen ? t("agent.toggleHide") : t("agent.toggleShow")}
          onClick={() => (agentOpen ? toggleAgent() : openAgent())}
          className={`mx-1 my-1.5 flex items-center gap-1.5 rounded-md px-2 text-xs transition-colors ${
            agentOpen
              ? "bg-accent/14 text-accent"
              : "text-ink-2 hover:bg-hover hover:text-ink"
          }`}
        >
          <Bot className="size-3.5" strokeWidth={1.75} />
          <span className="hidden sm:inline">{t("agent.shortcut")}</span>
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
