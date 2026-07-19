import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

import EditorWorkbench from "@/features/editor/EditorWorkbench";
import { useProjectStore } from "@/lib/stores/projectStore";

export default function EditorArea() {
  const { t } = useTranslation();
  const current = useProjectStore((s) => s.current);
  const openProject = useProjectStore((s) => s.openProject);

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, title: t("empty.openFolder") });
    if (typeof dir === "string") await openProject(dir);
  };

  if (current) {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-editor">
        <EditorWorkbench />
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-editor">
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5">
        <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-accent/12 text-accent">
          <span className="text-2xl font-black tracking-tight">G</span>
        </div>
        <h1 className="text-lg font-semibold text-ink">{t("empty.title")}</h1>
        <p className="text-xs text-ink-3">{t("empty.subtitle")}</p>
        <button
          onClick={() => void pickFolder()}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-ink shadow-sm transition-all duration-150 hover:bg-accent-hover hover:shadow-md active:scale-[0.98]"
        >
          <FolderOpen className="size-4" strokeWidth={1.75} />
          {t("empty.openFolder")}
        </button>
      </div>
    </main>
  );
}
