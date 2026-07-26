import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getVersion } from "@tauri-apps/api/app";

import { copyText } from "@/lib/clipboard";
import { ipc, type DiagnosticInfo } from "@/lib/ipc/ipc";
import { formatShortcut } from "@/lib/platform";
import { useOnboardingStore } from "@/lib/stores/onboardingStore";
import { useUiStore } from "@/lib/stores/uiStore";
import { useUpdaterStore } from "@/lib/stores/updaterStore";

import FaultDrillPanel from "./FaultDrillPanel";
export default function AboutSection() {
  const { t } = useTranslation();
  const openOnboarding = useOnboardingStore((s) => s.openOnboarding);
  const refresh = useOnboardingStore((s) => s.refresh);
  const runtime = useOnboardingStore((s) => s.runtime);
  const agents = useOnboardingStore((s) => s.agents);
  const loading = useOnboardingStore((s) => s.loading);
  const hostOs = useUiStore((s) => s.hostOs);
  const updateStatus = useUpdaterStore((state) => state.status);
  const updateVersion = useUpdaterStore((state) => state.version);
  const updateError = useUpdaterStore((state) => state.error);
  const checkForUpdate = useUpdaterStore((state) => state.checkForUpdate);
  const downloadUpdate = useUpdaterStore((state) => state.download);
  const installAndRestart = useUpdaterStore((state) => state.installAndRestart);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticInfo | null>(null);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [bundleBusy, setBundleBusy] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

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

  useEffect(() => {
    void ipc
      .diagnosticsInfo()
      .then(setDiagnostics)
      .catch(() => setDiagnostics(null));
  }, []);

  const createDiagnosticBundle = async () => {
    if (!window.confirm(t("settings.diagnosticBundleConfirm"))) return;
    setBundleBusy(true);
    setBundleError(null);
    try {
      const bundle = await ipc.diagnosticsCreateBundle();
      setBundlePath(bundle.path);
    } catch (error) {
      setBundleError(error instanceof Error ? error.message : String(error));
    } finally {
      setBundleBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[13px] font-medium text-ink">{t("app.name")}</div>
        <div className="mt-0.5 text-[11px] text-ink-3">
          {appVersion ? `v${appVersion}` : t("app.stage")}
          {appVersion ? ` · ${t("app.stage")}` : null}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-3">{t("settings.aboutHint")}</p>

      <div className="rounded-lg border border-line px-2.5 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-[0.06em] text-ink-3">
          {t("updater.title")}
        </div>
        <p className="text-[10.5px] leading-relaxed text-ink-3">
          {updateStatus === "available"
            ? t("updater.available", { version: updateVersion })
            : updateStatus === "downloaded"
              ? t("updater.ready")
              : updateStatus === "downloading"
                ? t("updater.downloading")
                : updateStatus === "installing"
                  ? t("updater.installing")
                  : updateStatus === "up-to-date"
                    ? t("updater.upToDate")
                    : t("updater.hint")}
        </p>
        {updateError && <p className="mt-1 text-[10px] text-danger">{updateError}</p>}
        <button
          type="button"
          disabled={updateStatus === "checking" || updateStatus === "downloading" || updateStatus === "installing"}
          onClick={() => {
            if (updateStatus === "available") void downloadUpdate();
            else if (updateStatus === "downloaded") void installAndRestart();
            else void checkForUpdate();
          }}
          className="mt-2 h-7 w-full rounded-md border border-line text-[10.5px] text-ink-2 hover:border-line-strong disabled:opacity-50"
        >
          {updateStatus === "checking"
            ? t("updater.checking")
            : updateStatus === "available"
              ? t("updater.download")
              : updateStatus === "downloaded"
                ? t("updater.restartInstall")
                : t("updater.check")}
        </button>
      </div>

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
              <kbd className="font-mono text-[10px] text-ink-3">
                {formatShortcut(keys, hostOs)}
              </kbd>
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

      <div className="rounded-lg border border-line px-2.5 py-2">
        <div className="mb-1.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">
          {t("settings.diagnosticsTitle")}
        </div>
        <p className="text-[10.5px] leading-relaxed text-ink-3">
          {t("settings.diagnosticsHint")}
        </p>
        {diagnostics && (
          <button
            type="button"
            title={diagnostics.logDir}
            onClick={() => copyText(diagnostics.logDir)}
            className="mt-2 block w-full truncate rounded bg-raised px-2 py-1 text-left font-mono text-[10px] text-ink-3 hover:text-ink-2"
          >
            {diagnostics.logDir}
          </button>
        )}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => void ipc.diagnosticsRevealLogs()}
            className="h-7 flex-1 rounded-md border border-line text-[10.5px] text-ink-2 hover:border-line-strong"
          >
            {t("settings.revealLogs")}
          </button>
          <button
            type="button"
            disabled={bundleBusy}
            onClick={() => void createDiagnosticBundle()}
            className="h-7 flex-1 rounded-md border border-line text-[10.5px] text-ink-2 hover:border-line-strong disabled:opacity-50"
          >
            {bundleBusy
              ? t("settings.diagnosticBundleCreating")
              : t("settings.createDiagnosticBundle")}
          </button>
        </div>
        {bundlePath && (
          <button
            type="button"
            title={bundlePath}
            onClick={() => copyText(bundlePath)}
            className="mt-2 block w-full truncate text-left font-mono text-[10px] text-ok hover:underline"
          >
            {t("settings.diagnosticBundleReady")}: {bundlePath}
          </button>
        )}
        {bundleError && <p className="mt-2 text-[10px] text-danger">{bundleError}</p>}
      </div>

      <button
        type="button"
        onClick={() => openOnboarding()}
        className="h-8 w-full rounded-md border border-line text-[11px] text-ink-2 hover:border-line-strong hover:text-ink"
      >
        {t("settings.onboardingOpen")}
      </button>
      <FaultDrillPanel />
    </div>
  );
}
