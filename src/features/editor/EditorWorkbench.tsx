import {
  Columns2,
  Copy,
  FileText,
  Loader2,
  PanelRightClose,
  Pin,
  Save,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import GlyphMark from "@/app/GlyphMark";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { copyText } from "@/lib/clipboard";
import { commandMatches } from "@/lib/keybindings";
import { isEditorTabDirty, useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";

import CodeEditor from "./CodeEditor";
import MediaPreview from "./MediaPreview";

export default function EditorWorkbench() {
  const { t } = useTranslation();
  const [tabMenu, setTabMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const primaryPath = useEditorStore((s) => s.primaryPath);
  const secondaryPath = useEditorStore((s) => s.secondaryPath);
  const focusedPane = useEditorStore((s) => s.focusedPane);
  const loading = useEditorStore((s) => s.loading);
  const error = useEditorStore((s) => s.error);
  const conflictPath = useEditorStore((s) => s.conflictPath);
  const recoveryNotice = useEditorStore((s) => s.recoveryNotice);
  const dismissRecoveryNotice = useEditorStore((s) => s.dismissRecoveryNotice);
  const closeTab = useEditorStore((s) => s.closeTab);
  const activateTab = useEditorStore((s) => s.activateTab);
  const focusPane = useEditorStore((s) => s.focusPane);
  const splitActive = useEditorStore((s) => s.splitActive);
  const closeSplit = useEditorStore((s) => s.closeSplit);
  const reorderTabs = useEditorStore((s) => s.reorderTabs);
  const pinTab = useEditorStore((s) => s.pinTab);
  const setContent = useEditorStore((s) => s.setContent);
  const saveActive = useEditorStore((s) => s.saveActive);
  const projectPath = useProjectStore((s) => s.current?.path ?? null);

  const active = tabs.find((tab) => tab.path === activePath) ?? null;
  const primary =
    tabs.find((tab) => tab.path === (primaryPath ?? activePath)) ?? active;
  const secondary = tabs.find((tab) => tab.path === secondaryPath) ?? null;
  const setActivePath = useCallback((path: string) => {
    void activateTab(path);
  }, [activateTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The CodeMirror keymap handles its own shortcuts (Ctrl+S in
      // particular) and prevents the default; running the command a second
      // time here raced the first save against the optimistic disk lock.
      if (event.defaultPrevented) return;
      const editorFocus =
        document.activeElement instanceof Element &&
        Boolean(document.activeElement.closest(".cm-editor"));
      const context = { editorFocus, projectOpen: Boolean(projectPath) };
      if (commandMatches(event, "editor.save", context)) {
        event.preventDefault();
        void saveActive();
        return;
      }
      if (commandMatches(event, "editor.close", context)) {
        const path = useEditorStore.getState().activePath;
        if (path) {
          event.preventDefault();
          void useEditorStore.getState().closeTab(path);
        }
        return;
      }
      if (commandMatches(event, "editor.nextTab", context)) {
        const state = useEditorStore.getState();
        if (state.tabs.length < 2 || !state.activePath) return;
        event.preventDefault();
        const currentIndex = state.tabs.findIndex((tab) => tab.path === state.activePath);
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (currentIndex + direction + state.tabs.length) % state.tabs.length;
        void state.activateTab(state.tabs[nextIndex].path);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projectPath, saveActive]);

  if (!active) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8">
        <GlyphMark size={30} className="opacity-30" />
        <p className="text-[12px] text-ink-3">{t("editor.pickFile")}</p>
        <p className="flex items-center gap-1.5 text-[11px] text-ink-3/80">
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
          {t("titlebar.palette")}
        </p>
      </div>
    );
  }

  const degradeReason = active.truncated
    ? t("editor.truncatedBanner")
    : active.longLines
      ? t("editor.longLinesBanner")
      : active.lossy
        ? t("editor.lossyBanner")
        : null;
  const conflictTab = conflictPath
    ? tabs.find((tab) => tab.path === conflictPath) ?? null
    : null;

  const menuTab = tabMenu ? tabs.find((tab) => tab.path === tabMenu.path) ?? null : null;
  const relativePath = menuTab && projectPath
    ? menuTab.path.replace(/\\/g, "/").startsWith(`${projectPath.replace(/\\/g, "/").replace(/\/$/, "")}/`)
      ? menuTab.path.replace(/\\/g, "/").slice(projectPath.replace(/\\/g, "/").replace(/\/$/, "").length + 1)
      : menuTab.name
    : menuTab?.name ?? "";
  const tabMenuItems: ContextMenuItem[] = menuTab
    ? [
        {
          id: "copy-path",
          label: t("editor.copyPath"),
          icon: <Copy className="size-3.5" />,
          action: () => copyText(menuTab.path),
        },
        {
          id: "copy-relative-path",
          label: t("editor.copyRelativePath"),
          icon: <FileText className="size-3.5" />,
          action: () => copyText(relativePath),
        },
        { id: "tab-separator", separator: true },
        {
          id: "pin-tab",
          label: t("editor.pinTab"),
          icon: <Pin className="size-3.5" />,
          disabled: !menuTab.ephemeral,
          action: () => pinTab(menuTab.path),
        },
        {
          id: "split-right",
          label: t("editor.splitRight"),
          icon: <Columns2 className="size-3.5" />,
          disabled: tabs.length < 2 || Boolean(secondaryPath),
          action: splitActive,
        },
        {
          id: "close-tab",
          label: t("editor.closeTab"),
          shortcut: "Ctrl+W",
          icon: <X className="size-3.5" />,
          action: () => closeTab(menuTab.path),
        },
        {
          id: "close-other-tabs",
          label: t("editor.closeOtherTabs"),
          disabled: tabs.length < 2,
          action: async () => {
            for (const tab of useEditorStore.getState().tabs) {
              if (tab.path === menuTab.path) continue;
              await useEditorStore.getState().closeTab(tab.path);
              if (useEditorStore.getState().tabs.some((item) => item.path === tab.path)) return;
            }
          },
        },
        {
          id: "close-tabs-right",
          label: t("editor.closeTabsToRight"),
          disabled: tabs.findIndex((tab) => tab.path === menuTab.path) === tabs.length - 1,
          action: async () => {
            const state = useEditorStore.getState();
            const index = state.tabs.findIndex((tab) => tab.path === menuTab.path);
            for (const tab of state.tabs.slice(index + 1)) {
              await useEditorStore.getState().closeTab(tab.path);
              if (useEditorStore.getState().tabs.some((item) => item.path === tab.path)) return;
            }
          },
        },
      ]
    : [];

  const renderPane = (
    tab: NonNullable<typeof active>,
    pane: "primary" | "secondary",
  ) => (
    <div
      key={`${pane}:${tab.path}`}
      className={`flex min-h-0 min-w-0 flex-1 flex-col ${
        pane === "secondary" ? "border-l border-line" : ""
      }`}
      onPointerDown={() => focusPane(pane)}
    >
      {secondary && (
        <div
          className={`flex h-6 shrink-0 items-center px-2 font-mono text-[10px] ${
            focusedPane === pane
              ? "border-b border-accent/50 bg-active text-ink-2"
              : "border-b border-line bg-panel text-ink-3"
          }`}
        >
          <span className="truncate">{tab.name}</span>
          {tab.ephemeral && <span className="ml-1 opacity-70">{t("editor.previewTab")}</span>}
        </div>
      )}
      {tab.preview ? (
        <MediaPreview tab={tab} />
      ) : (
        <CodeEditor
          tab={tab}
          focused={focusedPane === pane}
          onFocus={() => focusPane(pane)}
          onChange={(content) => setContent(tab.path, content)}
          onSave={() => void useEditorStore.getState().saveTab(tab.path)}
        />
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-editor">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-1.5">
        <div
          role="tablist"
          aria-label={t("editor.openTabs")}
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const dirty = isEditorTabDirty(tab);
            const selected = tab.path === activePath;
            return (
              // A tab is a container, not a button: it holds its own close
              // control, and nesting one interactive element inside another
              // hides the inner one from the keyboard entirely.
              <div
                key={tab.path}
                role="tab"
                aria-selected={selected}
                // Roving tabindex — Tab reaches the strip once, then the arrow
                // keys of the surrounding toolbar move within it.
                tabIndex={selected ? 0 : -1}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setActivePath(tab.path);
                }}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/glyphra-tab", tab.path);
                }}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes("text/glyphra-tab")) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const source = event.dataTransfer.getData("text/glyphra-tab");
                  if (source) reorderTabs(source, tab.path);
                }}
                onClick={() => setActivePath(tab.path)}
                onDoubleClick={() => pinTab(tab.path)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setTabMenu({ path: tab.path, x: event.clientX, y: event.clientY });
                }}
                className={`group flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-lg pl-2.5 pr-1.5 text-xs transition-colors duration-100 ${
                  selected
                    ? "bg-raised text-ink shadow-[var(--shadow-soft)]"
                    : "text-ink-3 hover:bg-hover hover:text-ink-2"
                }`}
                title={tab.path}
              >
                <span className={`truncate ${tab.ephemeral ? "italic" : ""}`}>{tab.name}</span>
                <button
                  type="button"
                  aria-label={t("editor.closeTabNamed", { name: tab.name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTab(tab.path);
                  }}
                  className="relative grid size-4 shrink-0 place-items-center rounded-md transition-colors hover:bg-hover"
                >
                  {dirty && (
                    <span className="absolute size-1.5 rounded-full bg-accent transition-opacity group-hover:opacity-0" />
                  )}
                  <X className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          disabled={active.readOnly || !isEditorTabDirty(active)}
          onClick={() => void saveActive()}
          title={`${t("editor.save")} · Ctrl+S`}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        </button>
        {secondary ? (
          <button
            type="button"
            onClick={closeSplit}
            title={t("editor.closeSplit")}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-hover hover:text-ink"
          >
            <PanelRightClose className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            disabled={tabs.length < 2}
            onClick={splitActive}
            title={t("editor.splitRight")}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-35"
          >
            <Columns2 className="size-3.5" />
          </button>
        )}
      </div>
      {error && (
        <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => useEditorStore.getState().clearError()}
            title={t("editor.dismiss")}
            className="grid size-5 shrink-0 place-items-center rounded hover:bg-hover"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {conflictTab && (
        <div className="flex flex-wrap items-center gap-2 border-b border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          <span className="min-w-0 flex-1">
            {t("editor.saveConflict", { name: conflictTab.name })}
          </span>
          <button
            type="button"
            onClick={() => {
              void useEditorStore.getState().saveTab(conflictTab.path, { force: true });
            }}
            className="h-6 shrink-0 rounded-md border border-warn/40 px-2 font-medium hover:bg-warn/15"
          >
            {t("editor.overwriteDisk")}
          </button>
          <button
            type="button"
            onClick={() => {
              void useEditorStore.getState().refreshTabFromDisk(conflictTab.path);
            }}
            className="h-6 shrink-0 rounded-md border border-warn/40 px-2 hover:bg-warn/15"
          >
            {t("editor.reloadFromDisk")}
          </button>
          <button
            type="button"
            onClick={() => useEditorStore.getState().clearConflict(conflictTab.path)}
            title={t("editor.dismiss")}
            className="grid size-5 shrink-0 place-items-center rounded hover:bg-hover"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {recoveryNotice && (
        <div className="flex items-center gap-2 border-b border-accent/30 bg-accent/10 px-3 py-2 text-xs text-accent">
          <span className="flex-1">
            {t("editor.recovered", { count: recoveryNotice.count })}
            {recoveryNotice.conflicts > 0
              ? ` ${t("editor.recoveredConflicts", { count: recoveryNotice.conflicts })}`
              : ""}
          </span>
          <button
            type="button"
            onClick={dismissRecoveryNotice}
            title={t("editor.dismissRecovery")}
            className="grid size-5 place-items-center rounded hover:bg-hover"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {degradeReason && (
        <div className="border-b border-line bg-accent/10 px-3 py-2 text-xs text-accent">{degradeReason}</div>
      )}
      <div className="flex min-h-0 flex-1">
        {primary ? renderPane(primary, "primary") : null}
        {secondary ? renderPane(secondary, "secondary") : null}
      </div>
      {tabMenu && menuTab && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={tabMenuItems}
          onClose={() => setTabMenu(null)}
        />
      )}
    </div>
  );
}
