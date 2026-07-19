import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
      <div className="flex flex-1 flex-col items-center justify-center px-8">
        <p className="text-[13px] tracking-wide text-ink-2">{t("empty.title")}</p>
        <p className="mt-2 max-w-xs text-center text-[11px] leading-relaxed text-ink-3">
          {t("empty.subtitle")}
        </p>
        <button
          type="button"
          onClick={() => void pickFolder()}
          className="mt-5 text-[11px] text-ink-2 underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
        >
          {t("empty.openFolder")}
        </button>
      </div>
    </main>
  );
}
