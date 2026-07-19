import { Loader2, Rocket, RefreshCw, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useOnboardingStore } from "@/lib/stores/onboardingStore";
import { useUiStore } from "@/lib/stores/uiStore";

import InstallCard from "./InstallCard";
import { agentGuides, runtimeGuides } from "./installGuides";

export default function OnboardingOverlay() {
  const { t } = useTranslation();
  const open = useOnboardingStore((s) => s.open);
  const loading = useOnboardingStore((s) => s.loading);
  const error = useOnboardingStore((s) => s.error);
  const runtime = useOnboardingStore((s) => s.runtime);
  const agents = useOnboardingStore((s) => s.agents);
  const refresh = useOnboardingStore((s) => s.refresh);
  const closeOnboarding = useOnboardingStore((s) => s.closeOnboarding);
  const openAgentPanel = () => {
    useUiStore.setState({ activePanel: "agent", sidebarOpen: true });
  };

  const os = runtime?.os ?? "linux";
  const runtimeCards = useMemo(() => runtimeGuides(os), [os]);
  const agentCards = useMemo(() => agentGuides(os), [os]);

  if (!open) return null;

  const runtimeStatus = (id: string) => {
    if (!runtime) return { installed: false, detail: undefined as string | undefined };
    const tool = { node: runtime.node, git: runtime.git }[id as "node" | "git"];
    if (!tool) return { installed: false, detail: undefined };
    return {
      installed: tool.installed,
      detail: [tool.version, tool.path].filter(Boolean).join(" · ") || undefined,
    };
  };

  const agentStatus = (id: string) => {
    const hit = agents.find((agent) => agent.backend === id);
    return {
      installed: hit?.installed ?? false,
      detail: hit?.detail,
    };
  };

  const essentialsReady = runtime?.node.installed && runtime?.git.installed;

  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-app/70 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[min(860px,92vh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-raised shadow-xl">
        <header className="flex items-start gap-3 border-b border-line px-4 py-3">
          <div className="grid size-9 place-items-center rounded-xl bg-accent/15 text-accent">
            <Rocket className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-ink">{t("onboarding.title")}</h2>
            <p className="mt-0.5 text-[11px] text-ink-3">{t("onboarding.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => closeOnboarding(false)}
            className="rounded-md p-1 text-ink-3 hover:bg-hover hover:text-ink"
            title={t("onboarding.skip")}
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              {t("onboarding.runtime")}
            </h3>
            {runtimeCards.map((guide) => {
              const status = runtimeStatus(guide.id);
              return (
                <InstallCard
                  key={guide.id}
                  guide={guide}
                  installed={status.installed}
                  detail={status.detail}
                />
              );
            })}
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              {t("onboarding.agents")}
            </h3>
            {agentCards.map((guide) => {
              const status = agentStatus(guide.id);
              return (
                <InstallCard
                  key={guide.id}
                  guide={guide}
                  installed={status.installed}
                  detail={status.detail}
                />
              );
            })}
          </section>

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-hover"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {t("onboarding.recheck")}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => closeOnboarding(true)}
            className="rounded-lg px-2.5 py-1.5 text-xs text-ink-3 hover:text-ink-2"
          >
            {t("onboarding.skip")}
          </button>
          <button
            type="button"
            onClick={() => {
              closeOnboarding(true);
              openAgentPanel();
            }}
            disabled={!essentialsReady}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-40"
          >
            {t("onboarding.continue")}
          </button>
        </footer>
      </div>
    </div>
  );
}
