import { Copy, FileText, Loader2, Save, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import GlyphMark from "@/app/GlyphMark";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { copyText } from "@/lib/clipboard";
import { useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";

import CodeEditor from "./CodeEditor";

export default function EditorWorkbench() {
  const { t } = useTranslation();
  const [tabMenu, setTabMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const loading = useEditorStore((s) => s.loading);
  const error = useEditorStore((s) => s.error);
  const closeTab = useEditorStore((s) => s.closeTab);
  const activateTab = useEditorStore((s) => s.activateTab);
  const setContent = useEditorStore((s) => s.setContent);
  const saveActive = useEditorStore((s) => s.saveActive);
  const projectPath = useProjectStore((s) => s.current?.path ?? null);

  const active = tabs.find((tab) => tab.path === activePath) ?? null;
  const setActivePath = useCallback((path: string) => {
    void activateTab(path);
  }, [activateTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActive();
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "w") {
        const path = useEditorStore.getState().activePath;
        if (path) {
          event.preventDefault();
          void useEditorStore.getState().closeTab(path);
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Tab") {
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
  }, [saveActive]);

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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-editor">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {tabs.map((tab) => {
            const dirty = tab.content !== tab.savedContent;
            const selected = tab.path === activePath;
            return (
              <button
                key={tab.path}
                onClick={() => setActivePath(tab.path)}
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
                <span className="truncate">{tab.name}</span>
                <span
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
                </span>
              </button>
            );
          })}
        </div>
        <button
          disabled={active.readOnly || active.content === active.savedContent}
          onClick={() => void saveActive()}
          title={`${t("editor.save")} · Ctrl+S`}
          className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        </button>
      </div>
      {error && <div className="border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div>}
      {degradeReason && (
        <div className="border-b border-line bg-accent/10 px-3 py-2 text-xs text-accent">{degradeReason}</div>
      )}
      <CodeEditor
        tab={active}
        onChange={(content) => setContent(active.path, content)}
        onSave={() => void saveActive()}
      />
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
