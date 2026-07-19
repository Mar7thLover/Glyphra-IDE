import { Loader2, Save, X } from "lucide-react";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useEditorStore } from "@/lib/stores/editorStore";

import CodeEditor from "./CodeEditor";

export default function EditorWorkbench() {
  const { t } = useTranslation();
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const loading = useEditorStore((s) => s.loading);
  const error = useEditorStore((s) => s.error);
  const closeTab = useEditorStore((s) => s.closeTab);
  const setContent = useEditorStore((s) => s.setContent);
  const saveActive = useEditorStore((s) => s.saveActive);

  const active = tabs.find((tab) => tab.path === activePath) ?? null;
  const setActivePath = useCallback((path: string) => {
    useEditorStore.setState({ activePath: path, error: null });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActive();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActive]);

  if (!active) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5">
        <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent/12 text-accent">
          <span className="text-2xl font-black tracking-tight">G</span>
        </div>
        <h1 className="text-lg font-semibold text-ink">{t("empty.title")}</h1>
        <p className="text-xs text-ink-3">{t("empty.subtitle")}</p>
      </div>
    );
  }

  const degradeReason = active.truncated
    ? t("editor.truncatedBanner")
    : active.longLines
      ? t("editor.longLinesBanner")
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-editor">
      <div className="flex h-9 shrink-0 items-center border-b border-line bg-panel/55">
        <div className="flex min-w-0 flex-1 overflow-hidden">
          {tabs.map((tab) => {
            const dirty = tab.content !== tab.savedContent;
            const selected = tab.path === activePath;
            return (
              <button
                key={tab.path}
                onClick={() => setActivePath(tab.path)}
                className={`group flex h-9 max-w-56 items-center gap-2 border-r border-line px-3 text-xs transition-colors ${
                  selected ? "bg-editor text-ink" : "text-ink-3 hover:bg-hover hover:text-ink-2"
                }`}
                title={tab.path}
              >
                <span className="truncate">{tab.name}</span>
                {dirty && <span className="size-1.5 rounded-full bg-accent" />}
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.path);
                  }}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-hover group-hover:opacity-100"
                >
                  <X className="size-3" />
                </span>
              </button>
            );
          })}
        </div>
        <button
          disabled={active.readOnly || active.content === active.savedContent}
          onClick={() => void saveActive()}
          className="mr-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {t("editor.save")}
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
    </div>
  );
}
