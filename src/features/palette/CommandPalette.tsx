import { Command } from "cmdk";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { openAgentsWindow } from "@/lib/agentWindow";
import { ipc } from "@/lib/ipc/ipc";
import { useEditorStore } from "@/lib/stores/editorStore";
import {
  absoluteFromIndex,
  rankFiles,
  useFileIndexStore,
} from "@/lib/stores/fileIndexStore";
import { usePaletteStore } from "@/lib/stores/paletteStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";
import { useSearchStore } from "@/lib/stores/searchStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore } from "@/lib/stores/uiStore";

const itemClass =
  "cursor-pointer rounded-lg px-2.5 py-1.5 text-[12px] text-ink aria-selected:bg-hover";
const groupClass = "px-1 py-1 text-[10px] text-ink-3";

export default function CommandPalette() {
  const { t, i18n } = useTranslation();
  const open = usePaletteStore((s) => s.open);
  const mode = usePaletteStore((s) => s.mode);
  const setOpen = usePaletteStore((s) => s.setOpen);
  const setMode = usePaletteStore((s) => s.setMode);
  const hasProject = useProjectStore((s) => !!s.current);
  const projectPath = useProjectStore((s) => s.current?.path ?? null);
  const files = useFileIndexStore((s) => s.files);
  const indexing = useFileIndexStore((s) => s.loading);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        usePaletteStore.getState().openCommands();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        usePaletteStore.getState().openFiles();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    if (mode === "files" && projectPath) {
      void useFileIndexStore.getState().ensureIndexed(projectPath);
    }
  }, [open, mode, projectPath]);

  const fileMatches = useMemo(() => {
    if (mode !== "files") return [];
    return rankFiles(files, query, 50);
  }, [mode, files, query]);

  if (!open) return null;

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  const toggleTheme = () => {
    const ui = useUiStore.getState();
    const next = ui.theme === "dark" ? "light" : "dark";
    ui.setTheme(next);
    const lang = i18n.language === "zh-CN" ? "zh-CN" : "en";
    void ipc.settingsSet({ theme: next, language: lang });
  };

  const placeholder =
    mode === "files" ? t("palette.filePlaceholder") : t("palette.placeholder");

  return (
    <div className="fixed inset-0 z-50 grid place-items-start bg-app/40 px-4 pt-[12vh] backdrop-blur-[2px]">
      <Command
        label={mode === "files" ? t("palette.filesTitle") : t("palette.title")}
        shouldFilter={mode === "commands"}
        className="glass-float pop-in mx-auto w-full max-w-xl overflow-hidden rounded-2xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder={placeholder}
          className="h-11 w-full border-b border-line bg-transparent px-3.5 text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
        <Command.List className="max-h-72 overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-4 text-[12px] text-ink-3">
            {mode === "files"
              ? indexing
                ? t("palette.indexing")
                : t("palette.fileEmpty")
              : t("palette.empty")}
          </Command.Empty>

          {mode === "files" ? (
            <Command.Group heading={t("palette.groupFiles")} className={groupClass}>
              {fileMatches.map((relative) => (
                <Command.Item
                  key={relative}
                  value={relative}
                  onSelect={() =>
                    run(() => {
                      if (!projectPath) return;
                      void useEditorStore
                        .getState()
                        .openFile(absoluteFromIndex(projectPath, relative));
                    })
                  }
                  className={`${itemClass} font-mono text-[11px]`}
                >
                  {relative}
                </Command.Item>
              ))}
              {hasProject && (
                <Command.Item
                  value="switch to commands"
                  onSelect={() => setMode("commands")}
                  className={itemClass}
                >
                  {t("palette.switchCommands")}
                </Command.Item>
              )}
            </Command.Group>
          ) : (
            <>
              <Command.Group heading={t("palette.groupNav")} className={groupClass}>
                {hasProject && (
                  <Command.Item
                    value="go to file fuzzy open"
                    onSelect={() => setMode("files")}
                    className={`${itemClass} flex items-center`}
                  >
                    <span>{t("palette.goToFile")}</span>
                    <span className="ml-auto text-[10px] text-ink-3">Ctrl P</span>
                  </Command.Item>
                )}
                <Command.Item
                  value="toggle agent"
                  onSelect={() => run(() => useUiStore.getState().toggleAgent())}
                  className={itemClass}
                >
                  {t("palette.toggleAgent")}
                </Command.Item>
                <Command.Item
                  value="open agents window"
                  onSelect={() => run(() => void openAgentsWindow())}
                  className={itemClass}
                >
                  {t("palette.openAgentsWindow")}
                </Command.Item>
                <Command.Item
                  value="open settings"
                  onSelect={() => run(() => useUiStore.getState().openSettings())}
                  className={itemClass}
                >
                  {t("palette.openSettings")}
                </Command.Item>
                {hasProject && (
                  <>
                    <Command.Item
                      value="search files"
                      onSelect={() =>
                        run(() => {
                          useUiStore.getState().togglePanel("search");
                          useSearchStore.getState().setQuery("");
                        })
                      }
                      className={itemClass}
                    >
                      {t("palette.openSearch")}
                    </Command.Item>
                    <Command.Item
                      value="toggle terminal"
                      onSelect={() => run(() => useTerminalStore.getState().toggle())}
                      className={itemClass}
                    >
                      {t("palette.toggleTerminal")}
                    </Command.Item>
                    <Command.Item
                      value="open review 审阅 changes diff"
                      onSelect={() =>
                        run(() =>
                          useReviewStore
                            .getState()
                            .openReview(useProjectStore.getState().current?.path),
                        )
                      }
                      className={`${itemClass} flex items-center`}
                    >
                      <span>{t("palette.openReview")}</span>
                      <span className="ml-auto text-[10px] text-ink-3">Ctrl Shift R</span>
                    </Command.Item>
                  </>
                )}
              </Command.Group>
              <Command.Group heading={t("palette.groupAppearance")} className={groupClass}>
                <Command.Item
                  value="toggle theme dark light"
                  onSelect={() => run(toggleTheme)}
                  className={itemClass}
                >
                  {t("palette.toggleTheme")}
                </Command.Item>
              </Command.Group>
            </>
          )}
        </Command.List>
      </Command>
      <button
        type="button"
        className="fixed inset-0 -z-10"
        aria-label="close"
        onClick={() => setOpen(false)}
      />
    </div>
  );
}
