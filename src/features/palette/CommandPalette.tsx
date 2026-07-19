import { Command } from "cmdk";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { usePaletteStore } from "@/lib/stores/paletteStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useReviewStore } from "@/lib/stores/reviewStore";
import { useSearchStore } from "@/lib/stores/searchStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore } from "@/lib/stores/uiStore";

export default function CommandPalette() {
  const { t } = useTranslation();
  const open = usePaletteStore((s) => s.open);
  const setOpen = usePaletteStore((s) => s.setOpen);
  const hasProject = useProjectStore((s) => !!s.current);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        usePaletteStore.getState().toggle();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        usePaletteStore.getState().setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-start bg-app/50 px-4 pt-[12vh] backdrop-blur-[1px]">
      <Command
        label={t("palette.title")}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-raised shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <Command.Input
          autoFocus
          placeholder={t("palette.placeholder")}
          className="h-11 w-full border-b border-line bg-transparent px-3 text-[13px] text-ink outline-none placeholder:text-ink-3"
        />
        <Command.List className="max-h-72 overflow-y-auto p-1">
          <Command.Empty className="px-3 py-4 text-[12px] text-ink-3">
            {t("palette.empty")}
          </Command.Empty>
          <Command.Group heading={t("palette.groupNav")} className="px-1 py-1 text-[10px] text-ink-3">
            <Command.Item
              value="toggle agent"
              onSelect={() => run(() => useUiStore.getState().toggleAgent())}
              className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink aria-selected:bg-hover"
            >
              {t("palette.toggleAgent")}
            </Command.Item>
            <Command.Item
              value="open settings"
              onSelect={() => run(() => useUiStore.getState().openSettings())}
              className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink aria-selected:bg-hover"
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
                  className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink aria-selected:bg-hover"
                >
                  {t("palette.openSearch")}
                </Command.Item>
                <Command.Item
                  value="toggle terminal"
                  onSelect={() => run(() => useTerminalStore.getState().toggle())}
                  className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink aria-selected:bg-hover"
                >
                  {t("palette.toggleTerminal")}
                </Command.Item>
                <Command.Item
                  value="open review"
                  onSelect={() => run(() => useReviewStore.getState().openReview())}
                  className="cursor-pointer rounded-md px-2 py-1.5 text-[12px] text-ink aria-selected:bg-hover"
                >
                  {t("palette.openReview")}
                </Command.Item>
              </>
            )}
          </Command.Group>
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
