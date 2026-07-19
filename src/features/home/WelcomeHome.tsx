import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Smartphone, Terminal } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useProjectStore } from "@/lib/stores/projectStore";
import { useUiStore } from "@/lib/stores/uiStore";

function ActionTile({
  icon: Icon,
  label,
  onClick,
  emphasis,
  disabled,
}: {
  icon: typeof FolderOpen;
  label: string;
  onClick?: () => void;
  emphasis?: "solid" | "muted";
  disabled?: boolean;
}) {
  const solid = emphasis === "solid";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex aspect-[1.35] flex-col items-center justify-center gap-2.5 rounded-xl border text-[12px] transition-colors ${
        solid
          ? "border-ink bg-ink text-[var(--bg-raised)] hover:opacity-90"
          : disabled
            ? "cursor-default border-line bg-raised/40 text-ink-3"
            : "border-line bg-[color-mix(in_srgb,var(--bg-panel)_70%,var(--bg-raised))] text-ink-2 hover:border-line-strong hover:bg-raised hover:text-ink"
      }`}
    >
      <Icon className="size-5" strokeWidth={1.5} />
      <span>{label}</span>
    </button>
  );
}

/** Cursor-like welcome: brand, action grid, recent projects. */
export default function WelcomeHome() {
  const { t } = useTranslation();
  const recents = useProjectStore((s) => s.recents);
  const openProject = useProjectStore((s) => s.openProject);
  const loadRecents = useProjectStore((s) => s.loadRecents);
  const openAgent = useUiStore((s) => s.openAgent);

  useEffect(() => {
    void loadRecents();
  }, [loadRecents]);

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, title: t("empty.openFolder") });
    if (typeof dir === "string") await openProject(dir);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-editor px-8 py-16">
      <div className="w-full max-w-[420px]">
        <h1 className="text-center text-[28px] font-semibold tracking-[0.18em] text-ink">
          {t("app.name").toUpperCase()}
        </h1>

        <div className="mt-10 grid grid-cols-2 gap-3">
          <ActionTile
            icon={FolderOpen}
            label={t("home.openProject")}
            onClick={() => void pickFolder()}
          />
          <ActionTile icon={Download} label={t("home.cloneRepo")} disabled />
          <ActionTile icon={Terminal} label={t("home.connectSsh")} disabled />
          <ActionTile
            icon={Smartphone}
            label={t("home.openAgent")}
            emphasis="solid"
            onClick={openAgent}
          />
        </div>

        <div className="mt-12">
          <div className="mb-3 text-[11px] text-ink-3">{t("home.recentProjects")}</div>
          {recents.length === 0 ? (
            <p className="text-[12px] text-ink-3">{t("home.recentEmpty")}</p>
          ) : (
            <ul className="space-y-0.5">
              {recents.map((project) => (
                <li key={project.path}>
                  <button
                    type="button"
                    onClick={() => void openProject(project.path)}
                    className="flex w-full items-baseline gap-4 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {project.name}
                    </span>
                    <span className="max-w-[55%] truncate text-[11px] text-ink-3">
                      {project.path}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
