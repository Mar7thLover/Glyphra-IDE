import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { ClipboardPaste, Copy, Eraser, Loader2, TerminalSquare, TextSelect, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "@/lib/ipc/ipc";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { copyText, readClipboardText } from "@/lib/clipboard";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore } from "@/lib/stores/uiStore";

import "@xterm/xterm/css/xterm.css";

// xterm measures glyphs through canvas APIs, where a CSS `var(...)` font value
// is not resolved consistently by every WebView. Keep this a concrete stack and
// put platform-native monospace fonts before the CJK fallbacks.
const TERMINAL_FONT_FAMILY = [
  '"Cascadia Mono"',
  '"Cascadia Code"',
  '"SFMono-Regular"',
  "Menlo",
  "Monaco",
  "Consolas",
  '"Liberation Mono"',
  '"Noto Sans Mono CJK SC"',
  '"Microsoft YaHei UI"',
  "monospace",
].join(", ");

const LIGHT_TERMINAL_FOREGROUND = "#1c1b19";
const DARK_TERMINAL_FOREGROUND = "#f2f2f2";

export default function TerminalPanel() {
  const { t } = useTranslation();
  const open = useTerminalStore((s) => s.open);
  const height = useTerminalStore((s) => s.height);
  const setOpen = useTerminalStore((s) => s.setOpen);
  const current = useProjectStore((s) => s.current);
  const theme = useUiStore((s) => s.theme);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    selection: string;
  } | null>(null);

  useEffect(() => {
    if (!open || !current || !hostRef.current) return;

    let disposed = false;
    let term: Terminal | null = null;
    let fit: FitAddon | null = null;
    let ptyId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const boot = async () => {
      setBooting(true);
      setError(null);
      term = new Terminal({
        allowProposedApi: false,
        cursorBlink: true,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: 13,
        letterSpacing: 0,
        lineHeight: 1.2,
        theme:
          theme === "dark"
            ? {
                background: "#0f1115",
                foreground: DARK_TERMINAL_FOREGROUND,
                // PowerShell/PSReadLine colors command input as ANSI yellow.
                yellow: DARK_TERMINAL_FOREGROUND,
                brightYellow: DARK_TERMINAL_FOREGROUND,
              }
            : {
                background: "#f7f6f3",
                foreground: LIGHT_TERMINAL_FOREGROUND,
                yellow: LIGHT_TERMINAL_FOREGROUND,
                brightYellow: LIGHT_TERMINAL_FOREGROUND,
              },
      });
      terminalRef.current = term;
      fit = new FitAddon();
      term.loadAddon(fit);
      term.loadAddon(new WebLinksAddon());
      // The built-in renderer is deliberately used here. WebGL glyph atlases
      // can calculate different cell widths for fallback CJK fonts in WebView2.
      await document.fonts.ready;
      if (disposed || !hostRef.current) return;
      term.open(hostRef.current);
      fit.fit();
      const cols = term.cols;
      const rows = term.rows;
      try {
        ptyId = await ipc.ptyOpen(current.path, cols, rows, (event) => {
          if (event.kind === "data") term?.write(event.data);
          if (event.kind === "exit") {
            term?.writeln("\r\n[process exited]");
          }
        });
        term.onData((data) => {
          if (ptyId != null) void ipc.ptyWrite(ptyId, data);
        });
        resizeObserver = new ResizeObserver(() => {
          if (!term || !fit || ptyId == null) return;
          fit.fit();
          void ipc.ptyResize(ptyId, term.cols, term.rows);
        });
        resizeObserver.observe(hostRef.current);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBooting(false);
      }
    };

    void boot();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      if (ptyId != null) void ipc.ptyClose(ptyId);
      term?.dispose();
      if (terminalRef.current === term) terminalRef.current = null;
    };
  }, [open, current?.path, theme]);

  if (!open) return null;

  const menuItems: ContextMenuItem[] = contextMenu
    ? [
        {
          id: "copy",
          label: t("menu.copy"),
          shortcut: "Ctrl+C",
          icon: <Copy className="size-3.5" />,
          disabled: !contextMenu.selection,
          action: () => copyText(contextMenu.selection),
        },
        {
          id: "paste",
          label: t("menu.paste"),
          shortcut: "Ctrl+V",
          icon: <ClipboardPaste className="size-3.5" />,
          action: async () => {
            const text = await readClipboardText();
            if (text) terminalRef.current?.paste(text);
          },
        },
        { id: "terminal-separator", separator: true },
        {
          id: "select-all",
          label: t("menu.selectAll"),
          shortcut: "Ctrl+A",
          icon: <TextSelect className="size-3.5" />,
          action: () => terminalRef.current?.selectAll(),
        },
        {
          id: "clear",
          label: t("terminal.clear"),
          icon: <Eraser className="size-3.5" />,
          action: () => terminalRef.current?.clear(),
        },
      ]
    : [];

  return (
    <div
      className="flex shrink-0 flex-col border-t border-line bg-panel"
      style={{ height }}
    >
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2">
        <TerminalSquare className="size-3.5 text-ink-3" strokeWidth={1.6} />
        <span className="text-[11px] font-medium text-ink-2">{t("terminal.title")}</span>
        <div className="flex-1" />
        {booting && <Loader2 className="size-3 animate-spin text-ink-3" />}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
        >
          <X className="size-3.5" strokeWidth={1.6} />
        </button>
      </header>
      {error && <div className="px-3 py-1 text-[11px] text-danger">{error}</div>}
      {!current ? (
        <div className="grid flex-1 place-items-center text-[11px] text-ink-3">
          {t("terminal.needProject")}
        </div>
      ) : (
        <div
          ref={hostRef}
          className="min-h-0 flex-1 px-1 py-1"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setContextMenu({
              x: event.clientX,
              y: event.clientY,
              selection: terminalRef.current?.getSelection() ?? "",
            });
          }}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
