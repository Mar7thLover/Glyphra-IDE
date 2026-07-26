import { useEffect, useState, type ReactNode } from "react";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppWindow, Copy, Minus, PanelRight, Search, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { openAgentsWindow } from "@/lib/agentWindow";
import { formatShortcut } from "@/lib/platform";
import { usePaletteStore } from "@/lib/stores/paletteStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useUiStore } from "@/lib/stores/uiStore";

import GlyphMark from "./GlyphMark";
import AppMenuBar from "./AppMenuBar";

const win = getCurrentWindow();

export function WinButton({
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

/** Minimize / maximize / close cluster, shared with the standalone Agents window. */
export function WindowControls() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);
  const hostOs = useUiStore((s) => s.hostOs);

  useEffect(() => {
    if (hostOs === "macos") return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void win.isMaximized().then(setMaximized);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [hostOs]);

  if (hostOs === "macos" || !hostOs) return null;

  return (
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
  );
}

/** Native-feeling traffic-light controls for undecorated macOS windows. */
export function MacWindowControls() {
  const { t } = useTranslation();
  const hostOs = useUiStore((s) => s.hostOs);
  if (hostOs !== "macos") return null;
  const dot =
    "group grid size-3 place-items-center rounded-full border border-black/10 text-transparent transition-colors hover:text-black/65";
  return (
    <div className="flex items-center gap-2 pl-3 pr-1">
      <button
        type="button"
        aria-label={t("titlebar.close")}
        title={t("titlebar.close")}
        onClick={() => void win.close()}
        className={`${dot} bg-[#ff5f57]`}
      >
        <X className="size-2" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        aria-label={t("titlebar.minimize")}
        title={t("titlebar.minimize")}
        onClick={() => void win.minimize()}
        className={`${dot} bg-[#febc2e]`}
      >
        <Minus className="size-2" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        aria-label={t("titlebar.maximize")}
        title={t("titlebar.maximize")}
        onClick={() => void win.toggleMaximize()}
        className={`${dot} bg-[#28c840]`}
      >
        <span className="size-1.5 rounded-sm border border-current" />
      </button>
    </div>
  );
}

export default function TitleBar() {
  const { t } = useTranslation();
  const agentOpen = useUiStore((s) => s.agentOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const closeSettings = useUiStore((s) => s.closeSettings);
  const openAgent = useUiStore((s) => s.openAgent);
  const toggleAgent = useUiStore((s) => s.toggleAgent);
  const openPalette = usePaletteStore((s) => s.setOpen);
  const projectName = useProjectStore((s) => s.current?.name);
  const hostOs = useUiStore((s) => s.hostOs);

  /** Titlebar is the sole quick entry for the right Agent panel. */
  const onAgentClick = () => {
    if (settingsOpen) {
      closeSettings();
      openAgent();
      return;
    }
    if (agentOpen) toggleAgent();
    else openAgent();
  };

  return (
    <header
      data-tauri-drag-region
      className="glass-panel relative z-50 flex h-10 shrink-0 items-stretch border-b border-line"
    >
      <MacWindowControls />
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3.5 pr-2">
        <GlyphMark size={15} className="pointer-events-none" />
        <span className="pointer-events-none text-[11px] font-medium tracking-wide text-ink-2">
          {t("app.name")}
        </span>
      </div>

      <AppMenuBar />

      <div data-tauri-drag-region className="flex-1" />

      {/* Centered command entry — one calm affordance for search & commands. */}
      <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 min-[1050px]:block">
        <button
          type="button"
          onClick={() => openPalette(true)}
          title={t("titlebar.palette")}
          className="flex h-[26px] w-[300px] max-w-[36vw] items-center gap-2 rounded-lg border border-line bg-raised/55 px-2.5 text-[11px] text-ink-3 shadow-[var(--shadow-soft)] transition-all duration-150 hover:border-line-strong hover:bg-raised hover:text-ink-2"
        >
          <Search className="size-3 shrink-0" strokeWidth={1.7} />
          <span className="min-w-0 flex-1 truncate text-left">
            {settingsOpen ? t("panel.settings") : (projectName ?? t("titlebar.palette"))}
          </span>
          <kbd className="shrink-0">{formatShortcut("Ctrl+K", hostOs)}</kbd>
        </button>
      </div>

      <div className="flex items-center gap-1 pr-1.5">
        <button
          type="button"
          title={agentOpen && !settingsOpen ? t("agent.toggleHide") : t("agent.toggleShow")}
          onClick={onAgentClick}
          className={`my-1.5 inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-all duration-150 ${
            agentOpen && !settingsOpen
              ? "btn-accent"
              : "border border-line bg-raised/70 text-ink-2 hover:border-line-strong hover:text-ink"
          }`}
        >
          <PanelRight className="size-3.5" strokeWidth={1.7} />
          {t("agent.shortcut")}
        </button>
        <button
          type="button"
          title={t("agent.openWindow")}
          onClick={() => void openAgentsWindow()}
          className="my-1.5 grid h-7 w-7 place-items-center rounded-lg text-ink-3 transition-colors hover:bg-hover hover:text-ink"
        >
          <AppWindow className="size-3.5" strokeWidth={1.7} />
        </button>
      </div>

      <WindowControls />
    </header>
  );
}
