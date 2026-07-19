import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { AgentPermissionMode, StartableBackend } from "@/lib/acp/types";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useProviderStore } from "@/lib/stores/providerStore";

import { SettingsField, SettingsSelect } from "./SettingsField";

export default function AgentSection() {
  const { t } = useTranslation();
  const defaultMode = usePrefsStore((s) => s.defaultMode);
  const defaultBackend = usePrefsStore((s) => s.defaultBackend);
  const defaultProviderId = usePrefsStore((s) => s.defaultProviderId);
  const setPref = usePrefsStore((s) => s.setPref);
  const providers = useProviderStore((s) => s.providers);
  const refresh = useProviderStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-ink-3">{t("settings.agentHint")}</p>

      <SettingsField label={t("settings.defaultMode")} hint={t("settings.defaultModeHint")}>
        <SettingsSelect
          value={defaultMode}
          onChange={(v) => setPref("defaultMode", v as AgentPermissionMode)}
        >
          <option value="safe">{t("agent.modeSafe")}</option>
          <option value="standard">{t("agent.modeStandard")}</option>
          <option value="unleashed">{t("agent.modeUnleashed")}</option>
        </SettingsSelect>
      </SettingsField>

      {defaultMode === "unleashed" && (
        <p className="text-[11px] text-danger">{t("agent.modeUnleashedWarn")}</p>
      )}

      <SettingsField label={t("settings.defaultBackend")}>
        <SettingsSelect
          value={defaultBackend}
          onChange={(v) => setPref("defaultBackend", v as StartableBackend)}
        >
          <option value="fixture">{t("agent.fixture")}</option>
          <option value="codex-acp">Codex ACP</option>
          <option value="claude-acp">Claude ACP</option>
          <option value="pi-agent">Pi Agent</option>
        </SettingsSelect>
      </SettingsField>

      <SettingsField label={t("settings.defaultProvider")} hint={t("settings.defaultProviderHint")}>
        <SettingsSelect
          value={defaultProviderId ?? ""}
          onChange={(v) => setPref("defaultProviderId", v || null)}
        >
          <option value="">{t("agent.providerNone")}</option>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </SettingsSelect>
      </SettingsField>
    </div>
  );
}
