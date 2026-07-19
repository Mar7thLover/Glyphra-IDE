import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Download, FolderOpen, Sparkles, Terminal } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useOnboardingStore } from "@/lib/stores/onboardingStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useProviderStore } from "@/lib/stores/providerStore";
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
  emphasis?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-[11px] transition-colors ${
        emphasis
          ? "border-ink bg-ink text-[var(--bg-raised)] hover:opacity-90"
          : disabled
            ? "cursor-default border-line bg-panel/40 text-ink-3"
            : "border-line bg-panel/70 text-ink-2 hover:border-line-strong hover:bg-raised hover:text-ink"
      }`}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.6} />
      <span className="truncate">{label}</span>
    </button>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block size-1.5 rounded-full ${ok ? "bg-accent" : "bg-ink-3/45"}`} />
  );
}

/** Welcome: four primary tiles on the canvas; everything else lives in one panel. */
export default function WelcomeHome() {
  const { t } = useTranslation();
  const recents = useProjectStore((s) => s.recents);
  const openProject = useProjectStore((s) => s.openProject);
  const loadRecents = useProjectStore((s) => s.loadRecents);
  const openAgent = useUiStore((s) => s.openAgent);
  const openOnboarding = useOnboardingStore((s) => s.openOnboarding);
  const refreshEnv = useOnboardingStore((s) => s.refresh);
  const runtime = useOnboardingStore((s) => s.runtime);
  const agents = useOnboardingStore((s) => s.agents);
  const envLoading = useOnboardingStore((s) => s.loading);
  const providers = useProviderStore((s) => s.providers);
  const refreshProviders = useProviderStore((s) => s.refresh);

  useEffect(() => {
    void loadRecents();
    void refreshEnv();
    void refreshProviders();
  }, [loadRecents, refreshEnv, refreshProviders]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void (async () => {
          const dir = await openDialog({ directory: true, title: t("empty.openFolder") });
          if (typeof dir === "string") await openProject(dir);
        })();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openProject, t]);

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, title: t("empty.openFolder") });
    if (typeof dir === "string") await openProject(dir);
  };

  const agentRows = agents.filter((a) => a.backend !== "custom-agent").slice(0, 4);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto bg-editor px-8 py-14">
      <div className="w-full max-w-[520px]">
        <h1 className="text-center text-[22px] font-semibold tracking-[0.14em] text-ink">
          {t("app.name").toUpperCase()}
        </h1>

        <div className="mt-7 grid grid-cols-4 gap-2">
          <ActionTile
            icon={FolderOpen}
            label={t("home.openProject")}
            onClick={() => void pickFolder()}
          />
          <ActionTile icon={Download} label={t("home.cloneRepo")} disabled />
          <ActionTile icon={Terminal} label={t("home.connectSsh")} disabled />
          <ActionTile
            icon={Sparkles}
            label={t("home.openAgent")}
            emphasis
            onClick={openAgent}
          />
        </div>

        {/* Secondary content: one inset panel, not loose canvas chrome */}
        <div className="mt-8 overflow-hidden rounded-xl border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
            <span className="text-[11px] font-medium text-ink-2">{t("home.workspace")}</span>
            <div className="flex items-center gap-2 text-[10px]">
              <button
                type="button"
                onClick={() => openOnboarding()}
                className="text-ink-3 hover:text-ink-2"
              >
                {t("home.setup")}
              </button>
              <span className="text-line-strong">·</span>
              <button
                type="button"
                onClick={() => useUiStore.getState().openSettings()}
                className="text-ink-3 hover:text-ink-2"
              >
                {t("rail.settings")}
              </button>
              <span className="text-line-strong">·</span>
              <button
                type="button"
                onClick={() => void refreshEnv()}
                className="text-ink-3 hover:text-ink-2"
              >
                {envLoading ? t("settings.loading") : t("onboarding.recheck")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <div className="px-3.5 py-3">
              <div className="mb-2 text-[10px] uppercase tracking-[0.06em] text-ink-3">
                {t("home.recentProjects")}
              </div>
              {recents.length === 0 ? (
                <p className="text-[11px] text-ink-3">{t("home.recentEmpty")}</p>
              ) : (
                <ul className="space-y-0.5">
                  {recents.slice(0, 6).map((project) => (
                    <li key={project.path}>
                      <button
                        type="button"
                        onClick={() => void openProject(project.path)}
                        className="-mx-1 flex w-[calc(100%+0.5rem)] items-baseline gap-2 rounded px-1 py-1 text-left hover:bg-hover"
                      >
                        <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                          {project.name}
                        </span>
                        <span className="max-w-[48%] truncate font-mono text-[10px] text-ink-3">
                          {project.path}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-4 px-3.5 py-3">
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">
                  {t("home.environment")}
                </div>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2 text-[11px]">
                    <StatusDot ok={!!runtime?.node.installed} />
                    <span className="w-14 text-ink-2">Node</span>
                    <span className="truncate text-ink-3">{runtime?.node.version ?? "—"}</span>
                  </li>
                  <li className="flex items-center gap-2 text-[11px]">
                    <StatusDot ok={!!runtime?.git.installed} />
                    <span className="w-14 text-ink-2">Git</span>
                    <span className="truncate text-ink-3">{runtime?.git.version ?? "—"}</span>
                  </li>
                  {agentRows.map((agent) => (
                    <li key={agent.backend} className="flex items-center gap-2 text-[11px]">
                      <StatusDot ok={agent.installed} />
                      <span className="min-w-0 flex-1 truncate font-mono text-ink-2">
                        {agent.backend}
                      </span>
                      <span className="truncate text-ink-3">
                        {agent.detail ||
                          (agent.installed ? t("onboarding.found") : t("onboarding.missing"))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">
                  {t("settings.providers")}
                </div>
                {providers.length === 0 ? (
                  <p className="text-[11px] text-ink-3">{t("settings.providersEmpty")}</p>
                ) : (
                  <ul className="space-y-1">
                    {providers.slice(0, 3).map((p) => (
                      <li key={p.id} className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="truncate text-ink-2">{p.name}</span>
                        <span className="truncate font-mono text-[10px] text-ink-3">
                          {p.model || p.kind}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap gap-1 border-t border-line pt-3">
                {(
                  [
                    ["Ctrl+O", t("home.openProject")],
                    ["Ctrl+J", t("agent.shortcut")],
                    ["Ctrl+,", t("rail.settings")],
                  ] as const
                ).map(([key, label]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-md bg-raised/80 px-1.5 py-0.5 text-[10px] text-ink-3"
                  >
                    <kbd className="font-mono text-ink-2">{key}</kbd>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
