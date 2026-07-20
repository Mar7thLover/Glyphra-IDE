import { ArrowUp, Infinity as InfinityIcon, Loader2, Shield, Sparkles, Square, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";

import type { AgentPermissionMode, StartableBackend } from "@/lib/acp/types";
import { useAgentStore } from "@/lib/stores/agentStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useProviderStore } from "@/lib/stores/providerStore";

import PillSelect, { type PillOption } from "./PillSelect";

/** Draft shared with empty-state suggestion chips (per-window singleton). */
export const useComposerDraft = create<{
  draft: string;
  setDraft: (draft: string) => void;
}>((set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
}));

export function providerCompatible(backend: StartableBackend, kind: string): boolean {
  if (!kind) return true;
  if (backend === "fixture") return true;
  if (backend === "codex-acp") {
    return kind === "custom-openai" || kind === "openai-key" || kind === "codex-login";
  }
  if (backend === "claude-acp") {
    return kind === "anthropic-key" || kind === "claude-subscription";
  }
  return true;
}

const backendLabel = (backend: string) =>
  backend === "codex-acp"
    ? "Codex"
    : backend === "claude-acp"
      ? "Claude"
      : backend === "pi-agent"
        ? "Pi"
        : backend === "fixture"
          ? "Fixture"
          : backend;

/**
 * Floating glass composer shared by the docked panel and the Agents window.
 * Input-first: submitting without a live session starts one, then sends.
 */
export default function AgentComposer({ cwd }: { cwd?: string }) {
  const { t } = useTranslation();
  const draft = useComposerDraft((s) => s.draft);
  const setDraft = useComposerDraft((s) => s.setDraft);

  const projectPath = useProjectStore((s) => cwd ?? s.current?.path ?? null);
  const session = useAgentStore((s) => s.session);
  const busy = useAgentStore((s) => s.busy);
  const mode = useAgentStore((s) => s.mode);
  const providerId = useAgentStore((s) => s.providerId);
  const backend = useAgentStore((s) => s.backend);
  const backends = useAgentStore((s) => s.backends);
  const circuitOpen = useAgentStore((s) => s.circuitOpen);
  const viewingArchiveId = useAgentStore((s) => s.viewingArchiveId);
  const setMode = useAgentStore((s) => s.setMode);
  const setProviderId = useAgentStore((s) => s.setProviderId);
  const setBackend = useAgentStore((s) => s.setBackend);
  const start = useAgentStore((s) => s.start);
  const prompt = useAgentStore((s) => s.prompt);
  const cancel = useAgentStore((s) => s.cancel);
  const clearArchiveView = useAgentStore((s) => s.clearArchiveView);
  const providers = useProviderStore((s) => s.providers);

  const taRef = useRef<HTMLTextAreaElement>(null);

  const backendInfo = backends.find((b) => b.backend === backend);
  const backendReady = backend === "fixture" || Boolean(backendInfo?.installed);
  const running = session?.status === "running" || session?.status === "busy";
  const canSend = session?.status === "running" && !busy;
  const canCompose = Boolean(projectPath) && backendReady && !circuitOpen;

  const filteredProviders = useMemo(
    () => providers.filter((p) => providerCompatible(backend, p.kind)),
    [providers, backend],
  );

  // Auto-grow up to ~7 lines, then scroll.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [draft]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = draft.trim();
    if (!value || busy) return;

    if (canSend) {
      setDraft("");
      void prompt(value);
      return;
    }
    if (running || !projectPath || !canCompose) return;

    // No live session yet — start one, then send the queued prompt.
    if (viewingArchiveId) clearArchiveView();
    setDraft("");
    await start(projectPath);
    if (useAgentStore.getState().session?.status === "running") {
      void prompt(value);
    } else {
      setDraft(value); // start failed or was declined — restore the draft
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME gate: Enter that commits a composition must never send the prompt.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const onBackendChange = (value: string) => {
    const next = value as StartableBackend;
    setBackend(next);
    if (providerId) {
      const provider = providers.find((p) => p.id === providerId);
      if (provider && !providerCompatible(next, provider.kind)) setProviderId(null);
    }
  };

  const placeholder = !projectPath
    ? t("agent.needProject")
    : !backendReady
      ? t("agent.needInstall")
      : viewingArchiveId
        ? t("agent.promptReadonly")
        : running
          ? t("agent.promptPlaceholder")
          : t("agent.promptIdle");

  const modeOptions: PillOption[] = [
    { value: "safe", label: t("agent.modeSafe"), hint: t("agent.modeSafeHint") },
    { value: "standard", label: t("agent.modeStandard"), hint: t("agent.modeStandardHint") },
    {
      value: "unleashed",
      label: t("agent.modeUnleashed"),
      hint: t("agent.modeUnleashedWarn"),
      danger: true,
    },
  ];

  const backendOptions: PillOption[] = backends
    .filter((b) => b.backend !== "custom-agent")
    .map((b) => ({
      value: b.backend,
      label: backendLabel(b.backend),
      hint: b.installed ? b.detail || t("agent.ready") : t("agent.missing"),
      disabled: !b.installed && b.backend !== "fixture",
    }));

  const providerOptions: PillOption[] = [
    { value: "", label: t("agent.providerNoneShort"), hint: t("agent.providerNone") },
    ...filteredProviders.map((p) => ({
      value: p.id,
      label: p.name,
      hint: p.hasSecret ? p.model || p.kind : t("settings.secretMissing"),
    })),
  ];

  const ModeIcon = mode === "safe" ? Shield : mode === "unleashed" ? Zap : InfinityIcon;

  return (
    <form onSubmit={(e) => void submit(e)} className="shrink-0 px-3 pb-3 pt-1.5">
      <div
        className={`glass-float rounded-2xl transition-colors ${
          mode === "unleashed" ? "border-danger/35" : "focus-within:border-line-strong"
        }`}
      >
        <textarea
          ref={taRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={!projectPath}
          rows={1}
          placeholder={placeholder}
          className="max-h-[168px] min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
        />
        <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5 pt-0.5">
          <PillSelect
            value={mode}
            options={modeOptions}
            onChange={(v) => setMode(v as AgentPermissionMode)}
            disabled={running}
            icon={ModeIcon}
            title={t("agent.hintMode")}
            renderLabel={() =>
              mode === "safe"
                ? t("agent.modeSafeShort")
                : mode === "unleashed"
                  ? t("agent.modeUnleashedShort")
                  : t("agent.modeStandardShort")
            }
          />
          <PillSelect
            value={backend}
            options={backendOptions}
            onChange={onBackendChange}
            disabled={running}
            icon={Sparkles}
            title={backendInfo?.detail}
          />
          {providerOptions.length > 1 && (
            <PillSelect
              value={providerId ?? ""}
              options={providerOptions}
              onChange={(v) => setProviderId(v || null)}
              disabled={running}
              title={t("agent.providerHint")}
              className="min-w-0"
            />
          )}
          <div className="ml-auto">
            {busy ? (
              <button
                type="button"
                onClick={() => void cancel()}
                title={t("agent.cancel")}
                className="grid size-7 place-items-center rounded-full border border-line bg-raised text-ink transition-colors hover:border-line-strong"
              >
                <Square className="size-3 fill-current" strokeWidth={1.6} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!draft.trim() || (!canSend && (!canCompose || running))}
                className="btn-accent grid size-7 place-items-center rounded-full disabled:opacity-30 disabled:shadow-none"
                title={t("agent.send")}
              >
                {session?.status === "starting" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" strokeWidth={2} />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
