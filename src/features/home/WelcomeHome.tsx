import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Download,
  FolderOpen,
  Settings2,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useOnboardingStore } from "@/lib/stores/onboardingStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useProviderStore } from "@/lib/stores/providerStore";
import { useUiStore } from "@/lib/stores/uiStore";

function QuietBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary,
}: {
  icon: typeof FolderOpen;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] transition-colors ${
        primary
          ? "border-ink bg-ink text-[var(--bg-raised)] hover:opacity-90"
          : disabled
            ? "cursor-default border-line text-ink-3"
            : "border-line text-ink-2 hover:border-line-strong hover:bg-hover hover:text-ink"
      }`}
    >
      <Icon className="size-3.5 opacity-80" strokeWidth={1.6} />
      {label}
    </button>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-medium text-ink-3">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[14px_72px_1fr] items-baseline gap-x-1 py-[3px] text-[11px]">
      <span className={`size-1.5 place-self-center rounded-full ${ok ? "bg-accent" : "bg-ink-3/45"}`} />
      <span className="truncate text-ink-2">{label}</span>
      <span className={`truncate ${ok ? "text-ink-3" : "text-ink-3/80"}`}>
        {detail || (ok ? t("onboarding.found") : t("onboarding.missing"))}
      </span>
    </div>
  );
}

/** Dense welcome: compact toolbar + multi-column lists. */
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

  const pickFolder = async () => {
    const dir = await openDialog({ directory: true, title: t("empty.openFolder") });
    if (typeof dir === "string") await openProject(dir);
  };

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

  const agentRows = agents.filter((a) => a.backend !== "custom-agent").slice(0, 6);
  const providerPreview = providers.slice(0, 4);

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto bg-editor px-8 py-8">
      <div className="flex w-full max-w-[760px] flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-[18px] font-semibold tracking-[0.12em] text-ink">
              {t("app.name").toUpperCase()}
            </h1>
            <span className="text-[11px] text-ink-3">{t("home.tagline")}</span>
            <span className="text-[10px] text-ink-3">{t("app.prealpha")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-2">
            <button
              type="button"
              onClick={() => openOnboarding()}
              className="inline-flex items-center gap-1 hover:text-ink"
            >
              <Wrench className="size-3" strokeWidth={1.6} />
              {t("home.setup")}
            </button>
            <button
              type="button"
              onClick={() => useUiStore.getState().togglePanel("settings")}
              className="inline-flex items-center gap-1 hover:text-ink"
            >
              <Settings2 className="size-3" strokeWidth={1.6} />
              {t("rail.settings")}
            </button>
            <button
              type="button"
              onClick={openAgent}
              className="inline-flex items-center gap-1 hover:text-ink"
            >
              <Sparkles className="size-3" strokeWidth={1.6} />
              {t("home.openAgent")}
            </button>
          </div>
        </header>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <QuietBtn
            icon={FolderOpen}
            label={t("home.openProject")}
            onClick={() => void pickFolder()}
          />
          <QuietBtn icon={Download} label={t("home.cloneRepo")} disabled />
          <QuietBtn icon={Terminal} label={t("home.connectSsh")} disabled />
          <QuietBtn
            icon={Sparkles}
            label={t("home.openAgent")}
            primary
            onClick={openAgent}
          />
          <span className="mx-1 h-4 w-px bg-line" />
          <span className="text-[10px] text-ink-3">{t("home.soon")}:</span>
          <span className="text-[10px] text-ink-3">{t("home.cloneRepo")}</span>
          <span className="text-[10px] text-ink-3">·</span>
          <span className="text-[10px] text-ink-3">{t("home.connectSsh")}</span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_0.95fr_0.9fr]">
          <Section
            title={t("home.recentProjects")}
            action={
              <button
                type="button"
                onClick={() => void pickFolder()}
                className="text-[10px] text-ink-3 hover:text-ink-2"
              >
                {t("home.openProject")}
              </button>
            }
          >
            {recents.length === 0 ? (
              <p className="border-t border-line py-2 text-[11px] text-ink-3">{t("home.recentEmpty")}</p>
            ) : (
              <ul className="border-t border-line">
                {recents.slice(0, 10).map((project) => (
                  <li key={project.path} className="border-b border-line">
                    <button
                      type="button"
                      onClick={() => void openProject(project.path)}
                      className="flex w-full items-baseline gap-2 py-1.5 text-left hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                        {project.name}
                      </span>
                      <span className="max-w-[55%] truncate font-mono text-[10px] text-ink-3">
                        {project.path}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={t("home.environment")}
            action={
              <button
                type="button"
                onClick={() => void refreshEnv()}
                className="text-[10px] text-ink-3 hover:text-ink-2"
              >
                {envLoading ? t("settings.loading") : t("onboarding.recheck")}
              </button>
            }
          >
            <div className="border-t border-line pt-1">
              <StatusRow
                label="Node"
                ok={!!runtime?.node.installed}
                detail={runtime?.node.version ?? undefined}
              />
              <StatusRow
                label="Git"
                ok={!!runtime?.git.installed}
                detail={runtime?.git.version ?? undefined}
              />
              {agentRows.map((agent) => (
                <StatusRow
                  key={agent.backend}
                  label={agent.backend}
                  ok={agent.installed}
                  detail={agent.detail ?? undefined}
                />
              ))}
              {!runtime && agentRows.length === 0 && (
                <p className="py-2 text-[11px] text-ink-3">{t("settings.loading")}</p>
              )}
            </div>
          </Section>

          <div className="space-y-5">
            <Section
              title={t("settings.providers")}
              action={
                <button
                  type="button"
                  onClick={() => useUiStore.getState().togglePanel("settings")}
                  className="text-[10px] text-ink-3 hover:text-ink-2"
                >
                  {t("rail.settings")}
                </button>
              }
            >
              <div className="border-t border-line pt-1">
                {providerPreview.length === 0 ? (
                  <p className="py-2 text-[11px] text-ink-3">{t("settings.providersEmpty")}</p>
                ) : (
                  providerPreview.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-baseline justify-between gap-2 py-[3px] text-[11px]"
                    >
                      <span className="truncate text-ink-2">{p.name}</span>
                      <span className="truncate font-mono text-[10px] text-ink-3">
                        {p.model || p.kind}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Section>

            <Section title={t("home.shortcuts")}>
              <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
                {(
                  [
                    ["Ctrl+O", t("home.openProject")],
                    ["Ctrl+J", t("agent.shortcut")],
                    ["Ctrl+,", t("rail.settings")],
                    ["Ctrl+B", t("home.toggleSidebar")],
                  ] as const
                ).map(([key, label]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-3"
                  >
                    <kbd className="font-mono text-ink-2">{key}</kbd>
                    {label}
                  </span>
                ))}
              </div>
            </Section>
          </div>
        </div>

        <p className="mt-6 text-[10px] text-ink-3">{t("home.footerHint")}</p>
      </div>
    </div>
  );
}
