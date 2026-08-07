import { Gauge, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ProviderKind } from "@/lib/ipc/ipc";
import { useProviderStore } from "@/lib/stores/providerStore";

import { SettingsField, SettingsInput, SettingsSelect } from "./SettingsField";

const PROVIDER_DEFAULTS: Record<
  ProviderKind,
  { name: string; baseUrl: string; model: string }
> = {
  "openai-key": { name: "OpenAI", baseUrl: "", model: "gpt-5" },
  "custom-openai": { name: "Custom OpenAI", baseUrl: "", model: "gpt-4.1-mini" },
  "anthropic-key": {
    name: "Anthropic",
    baseUrl: "",
    model: "claude-sonnet-4-20250514",
  },
  "codex-login": { name: "Codex / ChatGPT", baseUrl: "", model: "" },
  "claude-subscription": { name: "Claude", baseUrl: "", model: "" },
};

/** Models + API keys + subscription-backed providers. */
export default function ProvidersSection() {
  const { t } = useTranslation();
  const providers = useProviderStore((s) => s.providers);
  const loading = useProviderStore((s) => s.loading);
  const testingId = useProviderStore((s) => s.testingId);
  const usageLoadingId = useProviderStore((s) => s.usageLoadingId);
  const testResults = useProviderStore((s) => s.testResults);
  const usageResults = useProviderStore((s) => s.usageResults);
  const error = useProviderStore((s) => s.error);
  const refresh = useProviderStore((s) => s.refresh);
  const upsert = useProviderStore((s) => s.upsert);
  const remove = useProviderStore((s) => s.remove);
  const test = useProviderStore((s) => s.test);
  const queryUsage = useProviderStore((s) => s.queryUsage);
  const openRouterPreset = useProviderStore((s) => s.openRouterPreset);

  const [name, setName] = useState(PROVIDER_DEFAULTS["openai-key"].name);
  const [baseUrl, setBaseUrl] = useState(PROVIDER_DEFAULTS["openai-key"].baseUrl);
  const [model, setModel] = useState(PROVIDER_DEFAULTS["openai-key"].model);
  const [secret, setSecret] = useState("");
  const [kind, setKind] = useState<ProviderKind>("openai-key");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const needsEndpoint = kind === "custom-openai";
  const needsModel =
    kind === "custom-openai" || kind === "openai-key" || kind === "anthropic-key";
  const needsSecret = kind !== "codex-login" && kind !== "claude-subscription";

  const changeKind = (nextKind: ProviderKind) => {
    const defaults = PROVIDER_DEFAULTS[nextKind];
    setKind(nextKind);
    setName(defaults.name);
    setBaseUrl(defaults.baseUrl);
    setModel(defaults.model);
    setSecret("");
    setFormError(null);
  };

  const save = async () => {
    setFormError(null);
    if (!name.trim()) {
      setFormError(t("settings.nameRequired"));
      return;
    }
    if (needsSecret && !secret.trim()) {
      setFormError(t("settings.secretRequired"));
      return;
    }
    if (needsEndpoint && !baseUrl.trim()) {
      setFormError(t("settings.endpointRequired"));
      return;
    }
    if (needsModel && !model.trim()) {
      setFormError(t("settings.modelRequired"));
      return;
    }
    const saved = await upsert({
      kind,
      name: name.trim(),
      baseUrl: needsEndpoint ? baseUrl.trim() : null,
      model: needsModel ? model.trim() : null,
      secret: secret.trim() || null,
    });
    if (saved) setSecret("");
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-ink-3">{t("settings.providersHint")}</p>

      <div className="space-y-2.5 rounded-lg border border-line p-2.5">
        <div className="text-[10px] uppercase tracking-[0.06em] text-ink-3">
          {t("settings.addProvider")}
        </div>
        <SettingsField label={t("settings.providerKind")}>
          <SettingsSelect value={kind} onChange={(v) => changeKind(v as ProviderKind)}>
            <option value="openai-key">{t("settings.kindOpenai")}</option>
            <option value="anthropic-key">{t("settings.kindAnthropic")}</option>
            <option value="codex-login">{t("settings.kindCodex")}</option>
            <option value="claude-subscription">{t("settings.kindClaudeSub")}</option>
            <option value="custom-openai">{t("settings.kindCustomOpenai")}</option>
          </SettingsSelect>
        </SettingsField>
        <p className="rounded-md border border-line bg-hover px-2.5 py-2 text-[10px] leading-relaxed text-ink-3">
          {t(`settings.${
            kind === "openai-key"
              ? "kindOpenaiHint"
              : kind === "anthropic-key"
                ? "kindAnthropicHint"
                : kind === "codex-login"
                  ? "kindCodexHint"
                  : kind === "claude-subscription"
                    ? "kindClaudeSubHint"
                    : "kindCustomOpenaiHint"
          }`)}
        </p>
        <SettingsField label={t("settings.providerName")}>
          <SettingsInput value={name} onChange={(e) => setName(e.target.value)} />
        </SettingsField>
        {needsEndpoint && (
          <SettingsField
            label={t("settings.providerEndpoint")}
            hint={t("settings.providerEndpointHint")}
          >
            <SettingsInput
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://example.com/v1"
            />
          </SettingsField>
        )}
        {needsModel && (
          <SettingsField label={t("settings.providerModel")}>
            <SettingsInput value={model} onChange={(e) => setModel(e.target.value)} />
          </SettingsField>
        )}
        {needsSecret && (
          <SettingsField label={t("settings.providerSecret")}>
            <SettingsInput
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </SettingsField>
        )}
        {!needsSecret && (
          <p className="text-[10px] leading-relaxed text-ink-3">{t("settings.subscriptionHint")}</p>
        )}
        {formError && <p className="text-[11px] text-danger">{formError}</p>}
        <div className="flex gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() => void save()}
            className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-ink text-[11px] text-[var(--bg-raised)]"
          >
            <Plus className="size-3" />
            {t("settings.providerSave")}
          </button>
          {kind === "custom-openai" && (
            <button
              type="button"
              onClick={() => {
                const preset = openRouterPreset();
                setKind(preset.kind);
                setName(preset.name);
                setBaseUrl(preset.baseUrl);
                setModel(preset.model);
                setFormError(t("settings.openRouterNeedKey"));
              }}
              className="h-7 rounded-md border border-line px-2 text-[11px] text-ink-2 hover:bg-hover"
            >
              OpenRouter
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-1 text-[11px] text-ink-3">
          <Loader2 className="size-3 animate-spin" />
          {t("settings.loading")}
        </div>
      )}
      {error && <p className="text-[11px] text-danger">{error}</p>}

      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-[0.06em] text-ink-3">
          {t("settings.savedProviders")}
        </div>
        <div className="flex flex-col gap-1.5">
          {providers.map((provider) => {
            const result = testResults[provider.id];
            const usage = usageResults[provider.id];
            const subscription =
              provider.kind === "codex-login" || provider.kind === "claude-subscription";
            return (
              <div key={provider.id} className="rounded-lg border border-line px-2.5 py-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-ink-2">{provider.name}</span>
                  <span className="shrink-0 text-[10px] text-ink-3">
                    {subscription
                      ? t("settings.cliSubscription")
                      : provider.hasSecret
                        ? t("settings.secretStored")
                        : t("settings.secretMissing")}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[10px] text-ink-3">
                  {provider.kind}
                  {provider.model ? ` · ${provider.model}` : ""}
                </div>
                {result && (
                  <p
                    className={`mt-1 text-[10px] leading-relaxed ${
                      result.ok ? "text-ink-2" : "text-danger"
                    }`}
                  >
                    {result.detail}
                  </p>
                )}
                {usage && (
                  <div className="mt-2 space-y-1.5 rounded-md bg-raised/70 p-2">
                    <div className="flex items-center justify-between gap-2 text-[10px] text-ink-3">
                      <span>{usage.plan ? `${usage.source} · ${usage.plan}` : usage.source}</span>
                      {usage.creditsUnlimited ? (
                        <span>{t("settings.usageUnlimited")}</span>
                      ) : usage.creditsBalance ? (
                        <span>{t("settings.usageCredits", { value: usage.creditsBalance })}</span>
                      ) : null}
                    </div>
                    {usage.windows.map((window, index) => {
                      const remaining = window.remainingPercent;
                      return (
                        <div key={`${window.label}-${index}`}>
                          <div className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="truncate text-ink-2">{window.label}</span>
                            <span className="shrink-0 tabular-nums text-ink-3">
                              {remaining == null
                                ? window.remaining && window.limit
                                  ? `${window.remaining} / ${window.limit}`
                                  : t("settings.usageAvailable")
                                : t("settings.usageRemaining", {
                                    value: Math.round(remaining * 10) / 10,
                                  })}
                            </span>
                          </div>
                          {remaining != null && (
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
                              <div
                                className="h-full rounded-full bg-accent transition-[width]"
                                style={{ width: `${Math.max(0, Math.min(100, remaining))}%` }}
                              />
                            </div>
                          )}
                          {(window.resetsAt || window.resetAfter) && (
                            <div className="mt-0.5 text-[9px] text-ink-3">
                              {t("settings.usageResets", {
                                value: window.resetsAt
                                  ? new Date(window.resetsAt * 1000).toLocaleString()
                                  : window.resetAfter,
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <p className="text-[9px] leading-relaxed text-ink-3">{usage.detail}</p>
                  </div>
                )}
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void test(provider.id)}
                    className="rounded border border-line px-1.5 py-0.5 text-ink-2 hover:bg-hover"
                  >
                    {testingId === provider.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      t("settings.providerTest")
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void queryUsage(provider.id)}
                    className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-ink-2 hover:bg-hover"
                  >
                    {usageLoadingId === provider.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <>
                        <Gauge className="size-3" />
                        {t("settings.providerUsage")}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(provider.id)}
                    className="rounded border border-line px-1.5 py-0.5 text-ink-3 hover:text-danger"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
          {providers.length === 0 && !loading && (
            <p className="text-[11px] text-ink-3">{t("settings.providersEmpty")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
