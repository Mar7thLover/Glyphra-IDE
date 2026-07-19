import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ProviderKind } from "@/lib/ipc/ipc";
import { useProviderStore } from "@/lib/stores/providerStore";

export default function ProvidersSection() {
  const { t } = useTranslation();
  const providers = useProviderStore((s) => s.providers);
  const loading = useProviderStore((s) => s.loading);
  const testingId = useProviderStore((s) => s.testingId);
  const testDetail = useProviderStore((s) => s.testDetail);
  const error = useProviderStore((s) => s.error);
  const refresh = useProviderStore((s) => s.refresh);
  const upsert = useProviderStore((s) => s.upsert);
  const remove = useProviderStore((s) => s.remove);
  const test = useProviderStore((s) => s.test);
  const addOpenRouter = useProviderStore((s) => s.addOpenRouter);

  const [name, setName] = useState("Custom OpenAI");
  const [baseUrl, setBaseUrl] = useState("https://openrouter.ai/api/v1");
  const [model, setModel] = useState("openai/gpt-4.1-mini");
  const [secret, setSecret] = useState("");
  const [kind, setKind] = useState<ProviderKind>("custom-openai");

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="rounded-xl border border-line bg-raised/55 p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-ink-2">
        <KeyRound className="size-3.5" />
        {t("settings.providers")}
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-3">{t("settings.providersHint")}</p>

      <div className="mb-3 flex flex-col gap-2">
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as ProviderKind)}
          className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink"
        >
          <option value="custom-openai">Custom OpenAI-compatible</option>
          <option value="openai-key">OpenAI API key</option>
          <option value="anthropic-key">Anthropic API key</option>
          <option value="codex-login">Codex ChatGPT login</option>
          <option value="claude-subscription">Claude subscription</option>
        </select>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("settings.providerName")}
          className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink"
        />
        {(kind === "custom-openai" || kind === "openai-key") && (
          <>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="base_url"
              className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink"
            />
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="model"
              className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink"
            />
          </>
        )}
        {kind !== "codex-login" && kind !== "claude-subscription" && (
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={t("settings.providerSecret")}
            className="rounded-lg border border-line bg-panel px-2 py-1.5 text-xs text-ink"
          />
        )}
        <div className="flex gap-2">
          <button
            onClick={() =>
              void upsert({
                kind,
                name,
                baseUrl: kind === "custom-openai" || kind === "openai-key" ? baseUrl : null,
                model: kind === "custom-openai" || kind === "openai-key" ? model : null,
                secret: secret || null,
              }).then(() => setSecret(""))
            }
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-2 py-1.5 text-xs font-medium text-accent-ink"
          >
            <Plus className="size-3.5" />
            {t("settings.providerSave")}
          </button>
          <button
            onClick={() => void addOpenRouter()}
            className="rounded-lg border border-line px-2 py-1.5 text-xs text-ink-2 hover:bg-hover"
          >
            OpenRouter
          </button>
        </div>
      </div>

      {loading && (
        <div className="mb-2 flex items-center gap-1 text-[11px] text-ink-3">
          <Loader2 className="size-3 animate-spin" />
          {t("settings.loading")}
        </div>
      )}
      {error && <p className="mb-2 text-[11px] text-danger">{error}</p>}
      {testDetail && <p className="mb-2 text-[11px] text-ink-2">{testDetail}</p>}

      <div className="flex flex-col gap-1.5">
        {providers.map((provider) => (
          <div
            key={provider.id}
            className="rounded-lg border border-line bg-panel px-2 py-1.5 text-[11px]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium text-ink-2">{provider.name}</span>
              <span className="text-ink-3">
                {provider.hasSecret ? t("settings.secretStored") : t("settings.secretMissing")}
              </span>
            </div>
            <div className="truncate text-ink-3">
              {provider.kind}
              {provider.baseUrl ? ` · ${provider.baseUrl}` : ""}
              {provider.model ? ` · ${provider.model}` : ""}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button
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
                onClick={() => void remove(provider.id)}
                className="rounded border border-line px-1.5 py-0.5 text-ink-3 hover:text-danger"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          </div>
        ))}
        {providers.length === 0 && !loading && (
          <p className="text-[11px] text-ink-3">{t("settings.providersEmpty")}</p>
        )}
      </div>
    </section>
  );
}
