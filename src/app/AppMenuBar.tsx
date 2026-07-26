import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { openAgentsWindow } from "@/lib/agentWindow";
import { dispatchEditorCommand } from "@/lib/editorCommands";
import { formatShortcut } from "@/lib/platform";
import { isEditorTabDirty, useEditorStore } from "@/lib/stores/editorStore";
import { usePaletteStore } from "@/lib/stores/paletteStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore, type SettingsSection } from "@/lib/stores/uiStore";
import { closeCurrentProject, pickFile, pickProject } from "@/lib/workspaceActions";

type MenuId = "file" | "edit" | "view" | "terminal" | "settings" | "help";

interface MenuEntry {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  action?: () => void | Promise<void>;
}

function MenuDropdown({
  entries,
  onRun,
}: {
  entries: MenuEntry[];
  onRun: (entry: MenuEntry) => void;
}) {
  return (
    <div className="glass-float pop-in absolute left-0 top-[34px] z-[80] min-w-52 rounded-xl p-1.5">
      {entries.map((entry, index) =>
        entry.separator ? (
          <div key={`separator-${index}`} className="my-1 border-t border-line" />
        ) : (
          <button
            key={`${entry.label}-${index}`}
            type="button"
            disabled={entry.disabled}
            onClick={() => onRun(entry)}
            className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] text-ink-2 hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <span className="grid size-3 place-items-center">
              {entry.checked && <Check className="size-3" strokeWidth={2} />}
            </span>
            <span className="flex-1">{entry.label}</span>
            {entry.shortcut && (
              <kbd className="text-[9.5px] text-ink-3">{entry.shortcut}</kbd>
            )}
          </button>
        ),
      )}
    </div>
  );
}

export default function AppMenuBar() {
  const { t } = useTranslation();
  const root = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState<MenuId | null>(null);
  const current = useProjectStore((s) => s.current);
  const hasActive = useEditorStore((s) => s.activePath !== null);
  const canSave = useEditorStore((s) => {
    const active = s.tabs.find((tab) => tab.path === s.activePath);
    return Boolean(active && !active.readOnly && isEditorTabDirty(active));
  });
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const activePanel = useUiStore((s) => s.activePanel);
  const agentOpen = useUiStore((s) => s.agentOpen);
  const terminalOpen = useTerminalStore((s) => s.open);
  const reviewOpen = useReviewStore((s) => s.open);
  const hostOs = useUiStore((s) => s.hostOs);
  const hasProject = Boolean(current);

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("pointerdown", closeMenus);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", closeMenus);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const openSettings = (section: SettingsSection) => {
    useUiStore.getState().openSettings(section);
  };
  const unsaved = t("menu.unsavedProject");
  const entries: Record<MenuId, MenuEntry[]> = {
    file: [
      {
        label: t("menu.openProject"),
        shortcut: "Ctrl+O",
        action: () => pickProject(t("empty.openFolder"), unsaved),
      },
      {
        label: t("menu.openFile"),
        shortcut: "Ctrl+Shift+O",
        action: () => pickFile(t("menu.openFile"), unsaved),
      },
      {
        label: t("menu.save"),
        shortcut: "Ctrl+S",
        disabled: !canSave,
        action: () => useEditorStore.getState().saveActive(),
      },
      {
        label: t("editor.closeTab"),
        shortcut: "Ctrl+W",
        disabled: !hasActive,
        action: () => {
          const state = useEditorStore.getState();
          if (state.activePath) return state.closeTab(state.activePath);
        },
      },
      { separator: true, label: "" },
      {
        label: t("menu.closeProject"),
        disabled: !hasProject,
        action: () => closeCurrentProject(unsaved),
      },
      { separator: true, label: "" },
      {
        label: t("menu.exit"),
        shortcut: "Alt+F4",
        action: () => getCurrentWindow().close(),
      },
    ],
    edit: [
      {
        label: t("menu.undo"),
        shortcut: "Ctrl+Z",
        disabled: !hasActive,
        action: () => dispatchEditorCommand("undo"),
      },
      {
        label: t("menu.redo"),
        shortcut: "Ctrl+Y",
        disabled: !hasActive,
        action: () => dispatchEditorCommand("redo"),
      },
      { separator: true, label: "" },
      {
        label: t("menu.selectAll"),
        shortcut: "Ctrl+A",
        disabled: !hasActive,
        action: () => dispatchEditorCommand("selectAll"),
      },
      { separator: true, label: "" },
      {
        label: t("menu.commandPalette"),
        shortcut: "Ctrl+K",
        action: () => usePaletteStore.getState().openCommands(),
      },
      {
        label: t("palette.goToFile"),
        shortcut: "Ctrl+P",
        disabled: !hasProject,
        action: () => usePaletteStore.getState().openFiles(),
      },
    ],
    view: [
      {
        label: t("menu.explorer"),
        checked: sidebarOpen && activePanel === "files",
        disabled: !hasProject,
        action: () => useUiStore.getState().showPanel("files"),
      },
      {
        label: t("menu.search"),
        checked: sidebarOpen && activePanel === "search",
        disabled: !hasProject,
        action: () => useUiStore.getState().showPanel("search"),
      },
      {
        label: t("menu.review"),
        shortcut: "Ctrl+Shift+R",
        checked: reviewOpen,
        disabled: !hasProject,
        action: () => useReviewStore.getState().openReview(current?.path),
      },
      { separator: true, label: "" },
      {
        label: t("menu.agentPanel"),
        shortcut: "Ctrl+J",
        checked: agentOpen,
        disabled: !hasProject,
        action: () => useUiStore.getState().toggleAgent(),
      },
      { label: t("menu.agentsWindow"), action: () => openAgentsWindow() },
    ],
    terminal: [
      {
        label: t("menu.openTerminal"),
        shortcut: "Ctrl+`",
        checked: terminalOpen,
        disabled: !hasProject || terminalOpen,
        action: () => useTerminalStore.getState().setOpen(true),
      },
      {
        label: t("menu.closeTerminal"),
        disabled: !terminalOpen,
        action: () => useTerminalStore.getState().setOpen(false),
      },
    ],
    settings: [
      {
        label: t("menu.settingsHome"),
        shortcut: "Ctrl+,",
        action: () => openSettings("personal"),
      },
      { label: t("menu.editorSettings"), action: () => openSettings("editor") },
      { label: t("menu.modelSettings"), action: () => openSettings("models") },
      { label: t("menu.agentSettings"), action: () => openSettings("agent") },
    ],
    help: [
      {
        label: t("menu.showCommands"),
        shortcut: "Ctrl+K",
        action: () => usePaletteStore.getState().openCommands(),
      },
      {
        label: t("palette.goToFile"),
        shortcut: "Ctrl+P",
        disabled: !hasProject,
        action: () => usePaletteStore.getState().openFiles(),
      },
      { separator: true, label: "" },
      { label: t("menu.about"), action: () => openSettings("about") },
    ],
  };

  const run = (entry: MenuEntry) => {
    if (entry.disabled || !entry.action) return;
    setOpen(null);
    void entry.action();
  };

  return (
    <nav ref={root} aria-label={t("menu.aria")} className="flex h-full items-stretch">
      {(Object.keys(entries) as MenuId[]).map((id) => (
        <div key={id} className="relative flex items-stretch">
          <button
            type="button"
            aria-expanded={open === id}
            onClick={() => setOpen((current) => (current === id ? null : id))}
            onPointerEnter={() => {
              if (open) setOpen(id);
            }}
            className={`px-2 text-[11px] transition-colors ${open === id ? "bg-active text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"}`}
          >
            {t(`menu.${id}`)}
          </button>
          {open === id && (
            <MenuDropdown
              entries={entries[id].map((entry) => ({
                ...entry,
                shortcut: entry.shortcut
                  ? formatShortcut(entry.shortcut, hostOs)
                  : undefined,
              }))}
              onRun={run}
            />
          )}
        </div>
      ))}
    </nav>
  );
}
