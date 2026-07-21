import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";

import { useOnboardingStore } from "@/lib/stores/onboardingStore";

export default function AboutSection() {
  const { t } = useTranslation();
  const openOnboarding = useOnboardingStore((s) => s.openOnboarding);
  const refresh = useOnboardingStore((s) => s.refresh);
  const runtime = useOnboardingStore((s) => s.runtime);
  const agents = useOnboardingStore((s) => s.agents);
  const loading = useOnboardingStore((s) => s.loading);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch(() => {
        if (!cancelled) setAppVersion(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[13px] font-medium text-ink">{t("app.name")}</div>
        <div className="mt-0.5 text-[11px] text-ink-3">
          {appVersion ? `v${appVersion}` : t("app.prealpha")}
          {appVersion ? ` · ${t("app.prealpha")}` : null}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">{t("settings.aboutHint")}</p>

      <div className="rounded-lg border border-line px-2.5 py-2">
        <div className="mb-1.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">
          {t("settings.shortcutsTitle")}
        </div>
        <ul className="space-y-1 text-[11px]">
          {(
            [
              ["Ctrl+P", "settings.shortcutGoToFile"],
              ["Ctrl+K", "settings.shortcutCommands"],
              ["Ctrl+L", "settings.shortcutAskAgent"],
              ["Ctrl+Shift+R", "settings.shortcutReview"],
              ["Ctrl+Shift+F", "settings.shortcutSearch"],
              ["Ctrl+`", "settings.shortcutTerminal"],
              ["Ctrl+J", "settings.shortcutAgent"],
            ] as const
          ).map(([keys, label]) => (
            <li key={keys} className="flex items-center justify-between gap-3">
              <span className="text-ink-2">{t(label)}</span>
              <kbd className="font-mono text-[10px] text-ink-3">{keys}</kbd>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-line px-2.5 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.06em] text-ink-3">
            {t("home.environment")}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="text-[10px] text-ink-3 hover:text-ink-2"
          >
            {loading ? t("settings.loading") : t("onboarding.recheck")}
          </button>
        </div>
        <ul className="space-y-1 text-[11px]">
          <li className="flex justify-between gap-2">
            <span className="text-ink-2">Node</span>
            <span className="truncate text-ink-3">
              {runtime?.node.installed ? runtime.node.version : t("onboarding.missing")}
            </span>
          </li>
          <li className="flex justify-between gap-2">
            <span className="text-ink-2">Git</span>
            <span className="truncate text-ink-3">
              {runtime?.git.installed ? runtime.git.version : t("onboarding.missing")}
            </span>
          </li>
          {agents
            .filter((a) => a.backend !== "custom-agent")
            .slice(0, 4)
            .map((agent) => (
              <li key={agent.backend} className="flex justify-between gap-2">
                <span className="truncate font-mono text-ink-2">{agent.backend}</span>
                <span className="truncate text-ink-3">
                  {agent.installed
                    ? agent.detail || t("onboarding.found")
                    : t("onboarding.missing")}
                </span>
              </li>
            ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => openOnboarding()}
        className="h-8 w-full rounded-md border border-line text-[11px] text-ink-2 hover:border-line-strong hover:text-ink"
      >
        {t("settings.onboardingOpen")}
      </button>
    </div>
  );
}
