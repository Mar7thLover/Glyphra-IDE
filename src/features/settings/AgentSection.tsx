import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AgentPermissionMode, CustomAgentProtocol, StartableBackend } from "@/lib/acp/types";
import { useAgentStore } from "@/lib/stores/agentStore";
import { useHarnessStore } from "@/lib/stores/harnessStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useProviderStore } from "@/lib/stores/providerStore";

import { SettingsField, SettingsInput, SettingsSelect } from "./SettingsField";

export default function AgentSection() {
  const { t } = useTranslation();
  const defaultMode = usePrefsStore((s) => s.defaultMode);
  const defaultBackend = usePrefsStore((s) => s.defaultBackend);
  const defaultProviderId = usePrefsStore((s) => s.defaultProviderId);
  const setPref = usePrefsStore((s) => s.setPref);
  const setAgentProviderId = useAgentStore((s) => s.setProviderId);
  const providers = useProviderStore((s) => s.providers);
  const refresh = useProviderStore((s) => s.refresh);
  const harnesses = useHarnessStore((s) => s.harnesses);
  const upsertHarness = useHarnessStore((s) => s.upsert);
  const removeHarness = useHarnessStore((s) => s.remove);
  const [name, setName] = useState("My harness");
  const [protocol, setProtocol] = useState<CustomAgentProtocol>("acp");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("[]");
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

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
          <option value="auto">Auto-detect installed harness</option>
          <option value="fixture">{t("agent.fixture")}</option>
          <option value="codex-acp">Codex (native app-server)</option>
          <option value="claude-acp">Claude (native stream-json)</option>
          <option value="pi-agent">Pi (native JSON)</option>
          <option value="opencode-acp">OpenCode ACP</option>
          {harnesses.map((harness) => (
            <option key={harness.id} value={`custom:${harness.id}`}>
              {harness.name}
            </option>
          ))}
        </SettingsSelect>
      </SettingsField>

      <div className="space-y-2.5 rounded-lg border border-line p-2.5">
        <div className="text-[10px] uppercase tracking-[0.06em] text-ink-3">Custom harness API</div>
        <p className="text-[10px] leading-relaxed text-ink-3">
          ACP runs directly. Native JSONL, one-shot commands, OpenAI Responses/Chat, and Anthropic Messages are normalized into the same Agent timeline.
        </p>
        <SettingsField label="Display name">
          <SettingsInput value={name} onChange={(event) => setName(event.target.value)} />
        </SettingsField>
        <SettingsField label="Protocol">
          <SettingsSelect value={protocol} onChange={(value) => setProtocol(value as CustomAgentProtocol)}>
            <option value="acp">ACP (stdio)</option>
            <option value="stdio-jsonl">Glyphra JSONL (stdio)</option>
            <option value="shell-command">Shell command</option>
            <option value="openai-responses">OpenAI Responses API</option>
            <option value="openai-chat">OpenAI Chat Completions API</option>
            <option value="anthropic-messages">Anthropic Messages API</option>
          </SettingsSelect>
        </SettingsField>
        {protocol.startsWith("openai-") || protocol === "anthropic-messages" ? (
          <>
            <SettingsField label="Endpoint" hint="Select a Provider below to inject its key at runtime.">
              <SettingsInput value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:PORT/v1" />
            </SettingsField>
            <SettingsField label="Model">
              <SettingsInput value={model} onChange={(event) => setModel(event.target.value)} />
            </SettingsField>
          </>
        ) : (
          <>
            <SettingsField label="Executable">
              <SettingsInput value={command} onChange={(event) => setCommand(event.target.value)} placeholder="harness executable or absolute path" />
            </SettingsField>
            <SettingsField label="Arguments (JSON array)" hint={'Shell commands may use "{prompt}" and "{cwd}" placeholders.'}>
              <SettingsInput value={args} onChange={(event) => setArgs(event.target.value)} />
            </SettingsField>
          </>
        )}
        {formError && <p className="text-[11px] text-danger">{formError}</p>}
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            try {
              const parsedArgs = JSON.parse(args) as unknown;
              if (!name.trim()) throw new Error("Enter a display name.");
              if (!Array.isArray(parsedArgs) || !parsedArgs.every((value) => typeof value === "string")) throw new Error("Arguments must be a JSON string array.");
              if (!(protocol.startsWith("openai-") || protocol === "anthropic-messages") && !command.trim()) throw new Error("Enter an executable.");
              if ((protocol.startsWith("openai-") || protocol === "anthropic-messages") && !endpoint.trim()) throw new Error("Enter an API endpoint.");
              upsertHarness({ name, protocol, command, args: parsedArgs, env: {}, endpoint: endpoint || undefined, model: model || undefined });
            } catch (error) {
              setFormError(error instanceof Error ? error.message : String(error));
            }
          }}
          className="inline-flex h-7 w-full items-center justify-center gap-1 rounded-md bg-ink text-[11px] text-[var(--bg-raised)]"
        >
          <Plus className="size-3" /> Add harness
        </button>
      </div>

      {harnesses.length > 0 && (
        <div className="space-y-1.5">
          {harnesses.map((harness) => (
            <div key={harness.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2 text-[11px]">
              <div className="min-w-0">
                <div className="truncate font-medium text-ink-2">{harness.name}</div>
                <div className="truncate text-[10px] text-ink-3">{harness.protocol} · {harness.command || harness.endpoint}</div>
              </div>
              <button type="button" onClick={() => removeHarness(harness.id)} className="rounded border border-line p-1 text-ink-3 hover:text-danger">
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <SettingsField label={t("settings.defaultProvider")} hint={t("settings.defaultProviderHint")}>
        <SettingsSelect
          value={defaultProviderId ?? ""}
          onChange={(v) => {
            const providerId = v || null;
            setPref("defaultProviderId", providerId);
            setAgentProviderId(providerId);
          }}
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
