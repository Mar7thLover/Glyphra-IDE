import {
  Activity,
  ArrowUp,
  BrainCircuit,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  CornerUpRight,
  Database,
  FileCode2,
  Folder,
  Gauge,
  ImagePlus,
  ListPlus,
  Loader2,
  MessageSquarePlus,
  Puzzle,
  Quote,
  ScrollText,
  Server,
  Shield,
  ShieldCheck,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";

import type { AgentPermissionMode, StartableBackend } from "@/lib/acp/types";
import { appendAgentImageFiles, imageDataUrl } from "@/lib/agentImages";
import {
  composeAgentPrompt,
  findMentionMatch,
  findSlashMatch,
  hydrateFileReferences,
  replaceMentionMatch,
  replaceSlashMatch,
} from "@/lib/composerContext";
import { ipc } from "@/lib/ipc/ipc";
import { useAgentStore } from "@/lib/stores/agentStore";
import {
  COMPOSER_FOCUS_EVENT,
  useComposerDraft,
} from "@/lib/stores/composerStore";
import { useEditorStore } from "@/lib/stores/editorStore";
import {
  absoluteFromIndex,
  rankFiles,
  rankSymbols,
  useFileIndexStore,
  type ProjectRuleInfo,
} from "@/lib/stores/fileIndexStore";
import { useHarnessStore } from "@/lib/stores/harnessStore";
import { useMcpStore } from "@/lib/stores/mcpStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useProviderStore } from "@/lib/stores/providerStore";

import PillSelect, { type PillOption } from "./PillSelect";

type SlashItem = {
  id: string;
  label: string;
  detail: string;
  group: "command" | "file" | "skill" | "mcp";
  replacement: string;
  file?: { path: string; name: string };
};

type MentionItem = {
  id: string;
  label: string;
  detail: string;
  group: "file" | "folder" | "symbol";
  path: string;
  relativePath: string;
  line?: number;
  content: string;
};

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
        : backend === "opencode-acp"
          ? "OpenCode"
        : backend === "fixture"
          ? "Fixture"
          : backend;

/**
 * Floating glass composer shared by the docked panel and the Agents window.
 * Input-first: submitting without a live session starts one, then sends.
 */
export default function AgentComposer({ cwd }: { cwd?: string }) {
  const { t, i18n } = useTranslation();
  const isChinese = i18n.language.toLowerCase().startsWith("zh");
  const draft = useComposerDraft((s) => s.draft);
  const references = useComposerDraft((s) => s.references);
  const images = useComposerDraft((s) => s.images);
  const setDraft = useComposerDraft((s) => s.setDraft);
  const setReferences = useComposerDraft((s) => s.setReferences);
  const setImages = useComposerDraft((s) => s.setImages);
  const addReference = useComposerDraft((s) => s.addReference);
  const removeReference = useComposerDraft((s) => s.removeReference);
  const removeImage = useComposerDraft((s) => s.removeImage);
  const resetComposer = useComposerDraft((s) => s.reset);
  const optionsExpanded = useComposerDraft((s) => s.optionsExpanded);
  const toggleOptions = useComposerDraft((s) => s.toggleOptions);
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const [caret, setCaret] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const projectPath = useProjectStore((s) => cwd ?? s.current?.path ?? null);
  const indexedFiles = useFileIndexStore((s) => s.files);
  const indexedFolders = useFileIndexStore((s) => s.folders);
  const indexedSymbols = useFileIndexStore((s) => s.symbols);
  const projectRules = useFileIndexStore((s) => s.rules);
  const indexLoading = useFileIndexStore((s) => s.loading);
  const session = useAgentStore((s) => s.session);
  const items = useAgentStore((s) => s.items);
  const busy = useAgentStore((s) => s.busy);
  const mode = useAgentStore((s) => s.mode);
  const providerId = useAgentStore((s) => s.providerId);
  const model = useAgentStore((s) => s.model);
  const reasoningEffort = useAgentStore((s) => s.reasoningEffort);
  const contextWindow = useAgentStore((s) => s.contextWindow);
  const fastMode = useAgentStore((s) => s.fastMode);
  const catalog = useAgentStore((s) => s.catalog);
  const catalogLoading = useAgentStore((s) => s.catalogLoading);
  const catalogError = useAgentStore((s) => s.catalogError);
  const backend = useAgentStore((s) => s.backend);
  const backends = useAgentStore((s) => s.backends);
  const circuitOpen = useAgentStore((s) => s.circuitOpen);
  const viewingArchiveId = useAgentStore((s) => s.viewingArchiveId);
  const setMode = useAgentStore((s) => s.setMode);
  const setProviderId = useAgentStore((s) => s.setProviderId);
  const setModel = useAgentStore((s) => s.setModel);
  const setReasoningEffort = useAgentStore((s) => s.setReasoningEffort);
  const setContextWindow = useAgentStore((s) => s.setContextWindow);
  const setFastMode = useAgentStore((s) => s.setFastMode);
  const configureSession = useAgentStore((s) => s.configureSession);
  const refreshCatalog = useAgentStore((s) => s.refreshCatalog);
  const setBackend = useAgentStore((s) => s.setBackend);
  const start = useAgentStore((s) => s.start);
  const prompt = useAgentStore((s) => s.prompt);
  const queuedPrompts = useAgentStore((s) => s.queuedPrompts);
  const queuePrompt = useAgentStore((s) => s.queuePrompt);
  const redirectPrompt = useAgentStore((s) => s.redirectPrompt);
  const removeQueuedPrompt = useAgentStore((s) => s.removeQueuedPrompt);
  const cancel = useAgentStore((s) => s.cancel);
  const restart = useAgentStore((s) => s.restart);
  const newConversation = useAgentStore((s) => s.newConversation);
  const clearArchiveView = useAgentStore((s) => s.clearArchiveView);
  const providers = useProviderStore((s) => s.providers);
  const refreshProviders = useProviderStore((s) => s.refresh);
  const queryUsage = useProviderStore((s) => s.queryUsage);
  const usageLoadingId = useProviderStore((s) => s.usageLoadingId);
  const usageResults = useProviderStore((s) => s.usageResults);
  const customHarnesses = useHarnessStore((s) => s.harnesses);
  const configuredMcpServers = useMcpStore((s) => s.servers);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const usageRequestedRef = useRef(new Set<string>());
  const providersRequestedRef = useRef(false);

  const backendInfo = backends.find((b) => b.backend === backend);
  const customHarness = backend.startsWith("custom:")
    ? customHarnesses.find((item) => `custom:${item.id}` === backend)
    : null;
  const backendReady = backend === "fixture" || Boolean(backendInfo?.installed) || Boolean(customHarness);
  const running =
    session?.status === "running" ||
    session?.status === "busy" ||
    session?.status === "error";
  const conversationStarted = Boolean(
    viewingArchiveId || items.some((item) => item.kind === "user" || item.kind === "assistant"),
  );
  const canSend =
    (session?.status === "running" || session?.status === "error") && !busy;
  const canCompose =
    Boolean(projectPath) &&
    backendReady &&
    !circuitOpen &&
    !(backend === "codex-acp" && catalogLoading);
  const hasInput = Boolean(draft.trim() || references.length > 0 || images.length > 0);

  const slashMatch = useMemo(() => findSlashMatch(draft, caret), [caret, draft]);
  const slashItems = useMemo<SlashItem[]>(() => {
    const localCommands: SlashItem[] = [
      ["review", t("agent.slashReview")],
      ["explain", t("agent.slashExplain")],
      ["test", t("agent.slashTest")],
      ["fix", t("agent.slashFix")],
      ["translate", t("agent.slashTranslate")],
    ].map(([id, detail]) => ({
      id: `command-${id}`,
      label: `/${id}`,
      detail,
      group: "command" as const,
      replacement: `/${id} `,
    }));
    const nativeCommands: SlashItem[] = (session?.availableCommands ?? []).map(
      (command) => ({
        id: `native-command-${command.name}`,
        label: `/${command.name}`,
        detail: [
          t("agent.nativeCommand"),
          command.description || command.inputHint,
        ].filter(Boolean).join(" · "),
        group: "command" as const,
        replacement: `/${command.name} `,
      }),
    );
    const commands = [
      ...new Map(
        [...nativeCommands, ...localCommands].map((item) => [
          item.label.toLowerCase(),
          item,
        ]),
      ).values(),
    ];
    const referenceCommands: SlashItem[] = [
      {
        id: "skill-custom",
        label: "/skill <name>",
        detail: t("agent.slashSkill"),
        group: "skill",
        replacement: "/skill ",
      },
      {
        id: "mcp-custom",
        label: "/mcp <name>",
        detail: t("agent.slashMcp"),
        group: "mcp",
        replacement: "/mcp ",
      },
    ];
    const files = tabs.map((tab) => ({
      id: `file-${tab.path}`,
      label: tab.name,
      detail: tab.path === activePath ? `${t("agent.currentFile")} · ${tab.path}` : tab.path,
      group: "file" as const,
      replacement: "",
      file: { path: tab.path, name: tab.name },
    }));
    const skills = (catalog?.skills ?? []).map((skill) => ({
      id: `skill-${skill.name}`,
      label: skill.name,
      detail: skill.description || "Skill",
      group: "skill" as const,
      replacement: `/skill ${skill.name} `,
    }));
    const catalogMcpServers = (catalog?.mcpServers ?? []).filter((server) => server.status !== "disabled").map((server) => ({
      id: `mcp-${server.name}`,
      label: server.name,
      detail: server.status === "configured" ? t("agent.mcpConfigured") : server.status || "MCP",
      group: "mcp" as const,
      replacement: `/mcp ${server.name} `,
    }));
    const managedMcpServers = configuredMcpServers
      .filter((server) => server.enabled)
      .map((server) => ({
        id: `managed-mcp-${server.id}`,
        label: server.name,
        detail: `${t("agent.mcpConfigured")} · ${server.transport}`,
        group: "mcp" as const,
        replacement: `/mcp ${server.name} `,
      }));
    const mcpServers = [
      ...new Map(
        [...managedMcpServers, ...catalogMcpServers].map((item) => [
          item.label.toLowerCase(),
          item,
        ]),
      ).values(),
    ];
    const all = [...commands, ...referenceCommands, ...files, ...skills, ...mcpServers];
    if (!slashMatch?.query) return all;
    return all.filter((item) =>
      `${item.label} ${item.detail} ${item.group}`.toLowerCase().includes(slashMatch.query),
    );
  }, [
    activePath,
    catalog?.mcpServers,
    catalog?.skills,
    configuredMcpServers,
    session?.availableCommands,
    slashMatch?.query,
    t,
    tabs,
  ]);
  const showSlashMenu = Boolean(slashMatch && slashItems.length > 0);
  const mentionMatch = useMemo(() => findMentionMatch(draft, caret), [caret, draft]);
  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!mentionMatch || !projectPath) return [];
    const query = mentionMatch.query;
    const showFiles = mentionMatch.kind === null || mentionMatch.kind === "file";
    const showFolders = mentionMatch.kind === null || mentionMatch.kind === "folder";
    const showSymbols = mentionMatch.kind === null || mentionMatch.kind === "symbol";
    const perGroup = mentionMatch.kind === null ? 14 : 40;

    const files = showFiles
      ? rankFiles(indexedFiles, query, perGroup).map((relativePath) => ({
          id: `mention-file-${relativePath}`,
          label: relativePath.split("/").pop() ?? relativePath,
          detail: relativePath,
          group: "file" as const,
          path: absoluteFromIndex(projectPath, relativePath),
          relativePath,
          content: `Workspace file: ${relativePath}`,
        }))
      : [];
    const folders = showFolders
      ? rankFiles(indexedFolders, query, perGroup).map((relativePath) => ({
          id: `mention-folder-${relativePath}`,
          label: relativePath.split("/").pop() ?? relativePath,
          detail: relativePath,
          group: "folder" as const,
          path: absoluteFromIndex(projectPath, relativePath),
          relativePath,
          content: `Workspace folder: ${relativePath}`,
        }))
      : [];
    const symbols = showSymbols
      ? rankSymbols(indexedSymbols, query, perGroup).map((symbol) => ({
          id: `mention-symbol-${symbol.path}-${symbol.line}-${symbol.name}`,
          label: symbol.name,
          detail: `${symbol.kind} · ${symbol.path}:${symbol.line}`,
          group: "symbol" as const,
          path: absoluteFromIndex(projectPath, symbol.path),
          relativePath: symbol.path,
          line: symbol.line,
          content: `${symbol.signature}\nIndexed at ${symbol.path}:${symbol.line}`,
        }))
      : [];
    return [...files, ...folders, ...symbols];
  }, [
    indexedFiles,
    indexedFolders,
    indexedSymbols,
    mentionMatch,
    projectPath,
  ]);
  const showMentionMenu = Boolean(mentionMatch && projectPath);

  const usageTargetId = providerId ?? (
    backend === "codex-acp"
      ? "__codex_cli__"
      : backend === "claude-acp"
        ? "__claude_cli__"
        : null
  );
  const usage = usageTargetId ? usageResults[usageTargetId] : null;
  const usageLoading = usageTargetId != null && usageLoadingId === usageTargetId;

  const filteredProviders = useMemo(
    () =>
      providers.filter(
        (p) =>
          providerCompatible(backend, p.kind) &&
          p.kind !== "codex-login" &&
          p.kind !== "claude-subscription",
      ),
    [providers, backend],
  );

  useEffect(() => {
    if (!projectPath) return;
    void useFileIndexStore.getState().ensureIndexed(projectPath);
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath || running || catalogLoading || catalog || catalogError) return;
    void refreshCatalog(projectPath);
  }, [backend, providerId, projectPath, refreshCatalog, running, backends, catalog, catalogError, catalogLoading]);

  useEffect(() => {
    const selected = providers.find((provider) => provider.id === providerId);
    if (selected?.kind === "codex-login" || selected?.kind === "claude-subscription") {
      setProviderId(null);
    }
  }, [providerId, providers, setProviderId]);

  useEffect(() => {
    if (providersRequestedRef.current) return;
    providersRequestedRef.current = true;
    void refreshProviders();
  }, [refreshProviders]);

  useEffect(() => {
    if (!usageTargetId || usageRequestedRef.current.has(usageTargetId)) return;
    usageRequestedRef.current.add(usageTargetId);
    void queryUsage(usageTargetId);
  }, [queryUsage, usageTargetId]);

  // Auto-grow up to ~7 lines, then scroll.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [draft]);

  useEffect(() => {
    const focus = () => {
      taRef.current?.focus();
      const end = useComposerDraft.getState().draft.length;
      requestAnimationFrame(() => taRef.current?.setSelectionRange(end, end));
      setCaret(end);
    };
    window.addEventListener(COMPOSER_FOCUS_EVENT, focus);
    return () => window.removeEventListener(COMPOSER_FOCUS_EVENT, focus);
  }, []);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashMatch?.query]);

  useEffect(() => {
    setMentionIndex(0);
    if (mentionMatch) setRulesOpen(false);
  }, [mentionMatch?.kind, mentionMatch?.query]);

  useEffect(() => {
    setRulesOpen(false);
  }, [projectPath, optionsExpanded]);

  const applySlashItem = (item: SlashItem) => {
    if (!slashMatch) return;
    if (item.file) {
      addReference({
        kind: "file",
        label: item.file.name,
        path: item.file.path,
        content: `Workspace file: ${item.file.path}`,
      });
    }
    const next = replaceSlashMatch(draft, slashMatch, item.replacement);
    setDraft(next.value);
    setCaret(next.cursor);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const applyMentionItem = (item: MentionItem) => {
    if (!mentionMatch) return;
    addReference({
      kind: item.group,
      label:
        item.group === "symbol"
          ? `${item.label} · ${item.relativePath}:${item.line}`
          : item.relativePath,
      path: item.path,
      relativePath: item.relativePath,
      line: item.line,
      content: item.content,
    });
    const next = replaceMentionMatch(draft, mentionMatch);
    setDraft(next.value);
    setCaret(next.cursor);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const toggleRuleReference = (rule: ProjectRuleInfo) => {
    const attached = references.find(
      (reference) => reference.kind === "rule" && reference.path === rule.path,
    );
    if (attached) {
      removeReference(attached.id);
      return;
    }
    addReference({
      kind: "rule",
      label: rule.relativePath,
      path: rule.path,
      relativePath: rule.relativePath,
      content: `Project agent rules: ${rule.relativePath}`,
    });
  };

  const attachImages = async (files: Iterable<File>) => {
    if (session && !session.supportsImages) {
      setImageError(t("agent.imageUnsupported"));
      return;
    }
    const result = await appendAgentImageFiles(images, files);
    setImages(result.attachments);
    setImageError(result.rejected[0] ?? null);
  };

  const onImagePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
    void attachImages(files);
  };

  const onImageDrop = (event: DragEvent<HTMLFormElement>) => {
    const files = [...event.dataTransfer.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    event.preventDefault();
    void attachImages(files);
  };

  const submit = async (
    event?: FormEvent,
    behavior: "send" | "redirect" = "send",
  ) => {
    event?.preventDefault();
    const rawDraft = draft;
    const attached = references;
    const attachedImages = images;
    if (!rawDraft.trim() && attached.length === 0 && attachedImages.length === 0) return;

    // Inline the real file contents at send time so the agent doesn't have to
    // re-read: open tabs use their live buffer (unsaved edits included), others
    // fall back to disk. Oversized files are truncated with a marker.
    const resolved = await hydrateFileReferences(
      attached,
      tabs.filter((tab) => !tab.preview),
      async (path) => (await ipc.fsRead(path)).content,
      {
        indexedFiles: projectPath
          ? indexedFiles.map((relativePath) => ({
              relativePath,
              path: absoluteFromIndex(projectPath, relativePath),
            }))
          : [],
      },
    );
    const value = composeAgentPrompt(rawDraft, resolved);
    if (!value && attachedImages.length === 0) return;
    const displayText =
      rawDraft.trim() ||
      [
        ...attached.map((reference) => `@${reference.label}`),
        ...attachedImages.map((image) => image.name),
      ].join(" · ");
    const restoreComposer = () => {
      setDraft(rawDraft);
      setReferences(attached);
      setImages(attachedImages);
    };
    const clearComposer = () => {
      setDraft("");
      setReferences([]);
      setImages([]);
      setImageError(null);
    };

    const currentAgent = useAgentStore.getState();
    if (currentAgent.busy) {
      clearComposer();
      if (behavior === "redirect") {
        await redirectPrompt(value, displayText, attachedImages);
      } else {
        queuePrompt(value, displayText, attachedImages);
      }
      return;
    }
    if (
      currentAgent.session?.status === "running" ||
      currentAgent.session?.status === "error"
    ) {
      clearComposer();
      if (!(await prompt(value, displayText, attachedImages))) restoreComposer();
      return;
    }
    if (running || !projectPath || !canCompose) return;

    // No live session yet — start one, then send the queued prompt.
    if (viewingArchiveId) clearArchiveView();
    clearComposer();
    await start(projectPath);
    if (useAgentStore.getState().session?.status === "running") {
      if (!(await prompt(value, displayText, attachedImages))) restoreComposer();
    } else {
      restoreComposer(); // start failed or was declined — restore the composer
    }
  };

  const reconfigure = (change: () => void, live = false, refreshWhenIdle = false) => {
    change();
    if (running && !busy) {
      if (live) void configureSession();
      else void restart();
    } else if (refreshWhenIdle && projectPath) {
      void refreshCatalog(projectPath);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME gate: Enter that commits a composition must never send the prompt.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (showMentionMenu && mentionItems.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setMentionIndex(
          (current) => (current + direction + mentionItems.length) % mentionItems.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyMentionItem(mentionItems[mentionIndex] ?? mentionItems[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setCaret(-1);
        return;
      }
    }
    if (showSlashMenu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSlashIndex((current) => (current + direction + slashItems.length) % slashItems.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applySlashItem(slashItems[slashIndex] ?? slashItems[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setCaret(-1);
        return;
      }
    }
    if (event.key === "Escape" && rulesOpen) {
      event.preventDefault();
      setRulesOpen(false);
      return;
    }
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

  const beginNewConversation = async () => {
    await newConversation();
    resetComposer();
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const placeholder = !projectPath
    ? t("agent.needProject")
    : !backendReady
      ? t("agent.needInstall")
      : viewingArchiveId
        ? t("agent.promptReadonly")
        : running
          ? t("agent.promptPlaceholder")
          : backend === "codex-acp" && catalogLoading
            ? t("agent.preparingSandbox")
            : t("agent.promptIdle");

  const sandboxHint = catalog?.sandboxStatus && catalog.sandboxStatus !== "ready"
    ? isChinese
      ? `；Windows 沙箱状态：${catalog.sandboxStatus}，启动时将调用 Codex 官方初始化流程`
      : `; Windows sandbox: ${catalog.sandboxStatus}; Codex setup runs at start`
    : "";
  const modeOptions: PillOption[] = [
    {
      value: "safe",
      label: t("agent.modeSafe"),
      hint: `${t("agent.modeSafeHint")}${sandboxHint}`,
    },
    {
      value: "standard",
      label: t("agent.modeStandard"),
      hint: `${t("agent.modeStandardHint")}${sandboxHint}`,
    },
    {
      value: "unleashed",
      label: t("agent.modeUnleashed"),
      hint: t("agent.modeUnleashedWarn"),
      danger: true,
    },
  ];

  const backendOptions: PillOption[] = [
    ...backends
      .filter((b) => b.backend !== "custom-agent")
      .map((b) => ({
        value: b.backend,
        label: backendLabel(b.backend),
        hint: b.installed ? b.detail || t("agent.ready") : t("agent.missing"),
        disabled: !b.installed && b.backend !== "fixture",
      })),
    ...customHarnesses.map((harness) => ({
      value: `custom:${harness.id}`,
      label: harness.name,
      hint: `${harness.protocol} · ${harness.command || harness.endpoint || "API"}`,
    })),
  ];

  const providerOptions: PillOption[] = [
    { value: "", label: t("agent.providerNoneShort"), hint: t("agent.providerNone") },
    ...filteredProviders.map((p) => ({
      value: p.id,
      label: p.name,
      hint: p.hasSecret ? p.model || p.kind : t("settings.secretMissing"),
    })),
  ];

  const effortKey: Record<string, string> = {
    none: "effortNone",
    minimal: "effortMinimal",
    low: "effortLow",
    medium: "effortMedium",
    high: "effortHigh",
    xhigh: "effortXhigh",
    max: "effortMax",
  };
  const modelOptions: PillOption[] = (catalog?.models ?? []).map((entry) => ({
    value: entry.id,
    label: entry.label,
    hint: isChinese
      ? [
          entry.isDefault ? t("agent.modelDefault") : t("agent.modelAvailable"),
          t("agent.modelEffortCount", { count: entry.reasoningEfforts.length }),
          entry.supportsFastMode ? t("agent.modelFastAvailable") : null,
        ].filter(Boolean).join(" · ")
      : entry.description,
  }));
  const selectedModel = catalog?.models.find((entry) => entry.id === model);
  const effortOptions: PillOption[] = (selectedModel?.reasoningEfforts ?? []).map((entry) => ({
    value: entry.id,
    label: effortKey[entry.id] ? t(`agent.${effortKey[entry.id]}`) : entry.id,
    hint: effortKey[entry.id]
      ? `${t(`agent.${effortKey[entry.id]}Hint`)} · ${entry.id}`
      : entry.description,
  }));
  const formatTokens = (tokens: number) =>
    tokens >= 1_048_576
      ? `${Number((tokens / 1_048_576).toFixed(1))}M`
      : tokens >= 1024
        ? `${Number((tokens / 1024).toFixed(tokens >= 10_240 ? 0 : 1))}K`
        : String(Math.round(tokens));
  const reportedContextSize = session?.contextSize ?? null;
  const actualContextSize = reportedContextSize ?? contextWindow ?? catalog?.contextWindow ?? null;
  const contextLabel = actualContextSize
    ? session?.contextUsed != null
      ? `${formatTokens(session.contextUsed)} / ${formatTokens(actualContextSize)}`
      : formatTokens(actualContextSize)
    : isChinese
      ? "上下文"
      : "Context";
  const contextOptions: PillOption[] = [
    {
      value: "",
      label: catalog?.contextWindow
        ? `${t("agent.harnessDefault")} (${formatTokens(catalog.contextWindow)})`
        : t("agent.harnessDefault"),
    },
    ...[32_768, 65_536, 131_072, 262_144].map((tokens) => ({
      value: String(tokens),
      label: formatTokens(tokens),
      hint: t("agent.contextAutoCompact", {
        value: formatTokens(Math.floor(tokens * 0.9)),
      }),
    })),
    {
      value: String(1_048_576),
      label: `${formatTokens(1_048_576)} · ${t("agent.modelSupportRequired")}`,
      hint: reportedContextSize != null && reportedContextSize < 1_000_000
        ? t("agent.contextReportedLimit", { value: formatTokens(reportedContextSize) })
        : t("agent.contextOneMillionHint"),
      disabled: reportedContextSize == null || reportedContextSize < 1_000_000,
    },
  ];
  const conversationUsage = session?.usage ?? null;
  const conversationCost = session?.cost ?? null;
  const conversationUsageLabel = [
    conversationUsage
      ? t("agent.conversationTokens", {
          value: formatTokens(conversationUsage.totalTokens),
        })
      : null,
    conversationCost
      ? new Intl.NumberFormat(i18n.language, {
          style: "currency",
          currency: conversationCost.currency,
          maximumFractionDigits: Math.max(
            2,
            conversationCost.amount > 0 && conversationCost.amount < 0.01 ? 4 : 2,
          ),
        }).format(conversationCost.amount)
      : null,
  ].filter(Boolean).join(" · ");
  const conversationUsageHint = conversationUsage
    ? t("agent.conversationUsageHint", {
        input: formatTokens(conversationUsage.inputTokens),
        output: formatTokens(conversationUsage.outputTokens),
        thought: formatTokens(conversationUsage.thoughtTokens ?? 0),
        cached: formatTokens(conversationUsage.cachedReadTokens ?? 0),
      })
    : t("agent.conversationCostHint");
  const primaryUsage = usage?.windows.find((window) => window.remainingPercent != null);
  const usageLabel = usageLoading
    ? t("agent.usageLoading")
    : usage?.creditsUnlimited
      ? t("settings.usageUnlimited")
      : primaryUsage?.remainingPercent != null
        ? t("settings.usageRemaining", { value: Math.round(primaryUsage.remainingPercent) })
        : t("agent.usage");
  const usageOptions: PillOption[] = [
    {
      value: "refresh",
      label: t("agent.usageRefresh"),
      hint: usage?.plan ? `${usage.source} · ${usage.plan}` : usage?.source,
    },
    ...(usage?.windows ?? []).map((window, index) => ({
      value: `usage-${index}`,
      label: window.remainingPercent != null
        ? `${window.label} · ${Math.round(window.remainingPercent)}%`
        : window.remaining != null
          ? `${window.label} · ${window.remaining}`
          : window.label,
      hint: window.resetAfter ?? (
        window.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString() : undefined
      ),
      disabled: true,
    })),
  ];
  const customNeedsProvider = Boolean(
    customHarness &&
      ["openai-responses", "openai-chat", "anthropic-messages"].includes(
        customHarness.protocol,
      ),
  );
  const showProvider = Boolean(providerId) || customNeedsProvider;
  const attachedRuleCount = projectRules.filter((rule) =>
    references.some(
      (reference) => reference.kind === "rule" && reference.path === rule.path,
    ),
  ).length;

  const ModeIcon = mode === "safe" ? Shield : mode === "unleashed" ? Zap : ShieldCheck;

  // Everything past the essentials (mode / model) folds behind one chevron so the
  // composer keeps a single row of pills instead of three.

  return (
    <form
      onSubmit={(event) => void submit(event)}
      onDragOver={(event) => {
        if ([...event.dataTransfer.items].some((item) => item.kind === "file")) {
          event.preventDefault();
        }
      }}
      onDrop={onImageDrop}
      className="shrink-0 px-3 pb-3 pt-1.5"
    >
      <div
        className={`glass-float relative rounded-2xl transition-colors ${
          mode === "unleashed" ? "border-danger/35" : "focus-within:border-line-strong"
        }`}
      >
        {showMentionMenu && (
          <div className="glass-float pop-in absolute inset-x-0 bottom-full z-40 mb-2 max-h-72 overflow-y-auto rounded-xl p-1.5">
            <div className="flex items-center px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-ink-3">
              <span>{t("agent.mentionMenu")}</span>
              <span className="ml-auto normal-case tracking-normal">
                {t("agent.mentionScopeHint")}
              </span>
            </div>
            {mentionItems.map((item, index) => {
              const Icon =
                item.group === "folder"
                  ? Folder
                  : item.group === "symbol"
                    ? Braces
                    : FileCode2;
              return (
                <button
                  key={item.id}
                  type="button"
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setMentionIndex(index)}
                  onClick={() => applyMentionItem(item)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    mentionIndex === index
                      ? "bg-active text-ink"
                      : "text-ink-2 hover:bg-hover hover:text-ink"
                  }`}
                >
                  <Icon className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium">
                      {item.label}
                    </span>
                    <span className="block truncate text-[10px] text-ink-3">
                      {item.detail}
                    </span>
                  </span>
                  <span className="rounded border border-line px-1 py-0.5 text-[9px] uppercase text-ink-3">
                    {t(
                      `agent.mentionGroup${item.group[0].toUpperCase()}${item.group.slice(1)}`,
                    )}
                  </span>
                </button>
              );
            })}
            {mentionItems.length === 0 && (
              <div className="px-2 py-3 text-center text-[11px] text-ink-3">
                {indexLoading ? t("agent.contextIndexing") : t("agent.mentionEmpty")}
              </div>
            )}
          </div>
        )}
        {showSlashMenu && (
          <div className="glass-float pop-in absolute inset-x-0 bottom-full z-40 mb-2 max-h-72 overflow-y-auto rounded-xl p-1.5">
            <div className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-ink-3">
              {t("agent.slashMenu")}
            </div>
            {slashItems.map((item, index) => {
              const Icon = item.group === "file" ? FileCode2 : item.group === "skill" ? Puzzle : item.group === "mcp" ? Server : Sparkles;
              return (
                <button
                  key={item.id}
                  type="button"
                  onPointerDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSlashIndex(index)}
                  onClick={() => applySlashItem(item)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    slashIndex === index ? "bg-active text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"
                  }`}
                >
                  <Icon className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium">{item.label}</span>
                    <span className="block truncate text-[10px] text-ink-3">{item.detail}</span>
                  </span>
                  <span className="rounded border border-line px-1 py-0.5 text-[9px] uppercase text-ink-3">
                    {t(`agent.slashGroup${item.group[0].toUpperCase()}${item.group.slice(1)}`)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {references.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {references.map((reference) => (
              <span
                key={reference.id}
                title={reference.path ?? reference.content}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-active px-1.5 py-1 text-[10.5px] text-ink-2"
              >
                {reference.kind === "file" ? (
                  <FileCode2 className="size-3 shrink-0" />
                ) : reference.kind === "folder" ? (
                  <Folder className="size-3 shrink-0" />
                ) : reference.kind === "symbol" ? (
                  <Braces className="size-3 shrink-0" />
                ) : reference.kind === "rule" ? (
                  <ScrollText className="size-3 shrink-0" />
                ) : reference.kind === "code" ? (
                  <Code2 className="size-3 shrink-0" />
                ) : (
                  <Quote className="size-3 shrink-0" />
                )}
                <span className="max-w-52 truncate">{reference.label}</span>
                <button
                  type="button"
                  aria-label={t("agent.removeReference")}
                  onClick={() => removeReference(reference.id)}
                  className="rounded p-0.5 text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {images.map((image) => (
              <span
                key={image.id}
                className="group relative inline-flex items-center gap-1.5 rounded-lg border border-line bg-active p-1 pr-6 text-[10.5px] text-ink-2"
                title={image.name}
              >
                <img
                  src={imageDataUrl(image)}
                  alt=""
                  className="size-9 rounded object-cover"
                />
                <span className="max-w-28 truncate">{image.name}</span>
                <button
                  type="button"
                  aria-label={t("agent.removeImage")}
                  onClick={() => removeImage(image.id)}
                  className="absolute right-1 top-1 rounded p-0.5 text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {queuedPrompts.length > 0 && (
          <div className="space-y-1 px-3 pt-2.5">
            {queuedPrompts.map((queued, index) => (
              <div
                key={queued.id}
                className="flex items-center gap-1.5 rounded-md border border-line bg-raised/45 px-2 py-1 text-[10.5px] text-ink-2"
              >
                <ListPlus className="size-3 shrink-0 text-ink-3" />
                <span className="shrink-0 text-[9px] uppercase text-ink-3">
                  {t("agent.queuePosition", { position: index + 1 })}
                </span>
                <span className="min-w-0 flex-1 truncate">{queued.displayText}</span>
                <button
                  type="button"
                  onClick={() => removeQueuedPrompt(queued.id)}
                  aria-label={t("agent.queueRemove")}
                  className="rounded p-0.5 text-ink-3 hover:bg-hover hover:text-ink"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {imageError && (
          <div className="px-3 pt-2 text-[10.5px] text-danger">{imageError}</div>
        )}
        <textarea
          ref={taRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart);
          }}
          onClick={(event) => setCaret(event.currentTarget.selectionStart)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onPaste={onImagePaste}
          onKeyDown={onKeyDown}
          disabled={!projectPath}
          rows={1}
          placeholder={placeholder}
          className="max-h-[168px] min-h-[52px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
        />
        {/* Pills wrap; the send button stays pinned bottom-right so its
            position never shifts as options come and go. */}
        <div className="flex items-end gap-1.5 px-2.5 pb-2.5 pt-0.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void attachImages(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={!projectPath || Boolean(session && !session.supportsImages)}
              onClick={() => imageInputRef.current?.click()}
              title={
                session && !session.supportsImages
                  ? t("agent.imageUnsupported")
                  : t("agent.imageAttach")
              }
              className="grid size-6 place-items-center rounded-full border border-line bg-raised/55 text-ink-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ImagePlus className="size-3.5" strokeWidth={1.7} />
            </button>
            <PillSelect
              value={mode}
              options={modeOptions}
              onChange={(v) => reconfigure(() => setMode(v as AgentPermissionMode), true)}
              disabled={busy}
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
            {catalogLoading && (
              <span
                title={t("agent.preparingSandbox")}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[11px] text-ink-3"
              >
                <Loader2 className="size-3 animate-spin" /> {t("agent.preparing")}
              </span>
            )}
            {!catalogLoading && modelOptions.length > 0 && (
              <PillSelect
                value={model ?? ""}
                options={modelOptions}
                onChange={(value) => reconfigure(() => setModel(value || null), true)}
                disabled={busy}
                icon={BrainCircuit}
                title={catalogError ?? t("agent.modelHint")}
              />
            )}
            {conversationStarted && (
              <button
                type="button"
                onClick={() => void beginNewConversation()}
                title={t("agent.newConversationHint")}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-raised/55 px-2 text-[11px] text-ink-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-ink"
              >
                <MessageSquarePlus className="size-3" strokeWidth={1.7} />
                {t("agent.newConversation")}
              </button>
            )}
            <button
              type="button"
              aria-expanded={optionsExpanded}
              onClick={toggleOptions}
              title={optionsExpanded ? t("agent.optionsCollapse") : t("agent.optionsExpand")}
              aria-label={optionsExpanded ? t("agent.optionsCollapse") : t("agent.optionsExpand")}
              className={`grid size-6 place-items-center rounded-full border border-line bg-raised/55 text-ink-3 transition-colors hover:border-line-strong hover:bg-raised hover:text-ink ${
                optionsExpanded ? "border-line-strong text-ink-2" : ""
              }`}
            >
              <ChevronRight
                className={`size-3 transition-transform ${optionsExpanded ? "rotate-180" : ""}`}
                strokeWidth={2}
              />
            </button>
            {optionsExpanded && (
              <>
                <div className="relative">
                  <button
                    type="button"
                    aria-expanded={rulesOpen}
                    onClick={() => setRulesOpen((open) => !open)}
                    title={t("agent.rulesHint")}
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-raised/55 px-2 text-[11px] text-ink-2 transition-colors hover:border-line-strong hover:bg-raised hover:text-ink"
                  >
                    {indexLoading ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <ScrollText className="size-3" strokeWidth={1.7} />
                    )}
                    {t("agent.rulesStatus", { count: projectRules.length })}
                    {attachedRuleCount > 0 && (
                      <span className="rounded-full bg-accent/15 px-1 text-[9px] text-accent">
                        {attachedRuleCount}
                      </span>
                    )}
                    <ChevronDown
                      className={`size-2.5 transition-transform ${rulesOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {rulesOpen && (
                    <div className="glass-float pop-in absolute bottom-full left-0 z-50 mb-2 w-80 rounded-xl p-1.5">
                      <div className="px-2 pb-1.5 pt-0.5">
                        <div className="text-[11px] font-medium text-ink">
                          {t("agent.rulesTitle")}
                        </div>
                        <div className="mt-0.5 text-[10px] leading-relaxed text-ink-3">
                          {t("agent.rulesDescription")}
                        </div>
                      </div>
                      {projectRules.map((rule) => {
                        const attached = references.some(
                          (reference) =>
                            reference.kind === "rule" && reference.path === rule.path,
                        );
                        return (
                          <div
                            key={rule.path}
                            className="flex items-center gap-1 rounded-lg hover:bg-hover"
                          >
                            <button
                              type="button"
                              onClick={() => toggleRuleReference(rule)}
                              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                              title={
                                attached
                                  ? t("agent.rulesDetach")
                                  : t("agent.rulesAttach")
                              }
                            >
                              <span
                                className={`grid size-4 shrink-0 place-items-center rounded border ${
                                  attached
                                    ? "border-accent bg-accent text-white"
                                    : "border-line-strong text-transparent"
                                }`}
                              >
                                <Check className="size-2.5" strokeWidth={2.5} />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-[11px] font-medium text-ink">
                                  {rule.name}
                                </span>
                                <span className="block truncate font-mono text-[9.5px] text-ink-3">
                                  {rule.relativePath}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRulesOpen(false);
                                void useEditorStore.getState().openFile(rule.path);
                              }}
                              className="mr-1 rounded-md p-1.5 text-ink-3 hover:bg-active hover:text-ink"
                              title={t("agent.rulesOpen")}
                              aria-label={t("agent.rulesOpen")}
                            >
                              <FileCode2 className="size-3.5" />
                            </button>
                          </div>
                        );
                      })}
                      {!indexLoading && projectRules.length === 0 && (
                        <div className="px-2 py-3 text-center text-[10.5px] text-ink-3">
                          {t("agent.rulesEmpty")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {!conversationStarted && (
                  <PillSelect
                    value={backend}
                    options={backendOptions}
                    onChange={onBackendChange}
                    disabled={running}
                    icon={Sparkles}
                    title={backendInfo?.detail}
                  />
                )}
                {effortOptions.length > 0 && (
                  <PillSelect
                    value={reasoningEffort ?? ""}
                    options={effortOptions}
                    onChange={(value) =>
                      reconfigure(() => setReasoningEffort(value || null), true)
                    }
                    disabled={busy}
                    icon={Gauge}
                    title={t("agent.reasoningEffortHint")}
                  />
                )}
                {selectedModel?.supportsFastMode && (
                  <PillSelect
                    value={fastMode ? "on" : "off"}
                    options={[
                      { value: "off", label: t("agent.fastOff"), hint: t("agent.fastOffHint") },
                      { value: "on", label: t("agent.fastOn"), hint: t("agent.fastOnHint") },
                    ]}
                    onChange={(value) =>
                      reconfigure(() => setFastMode(value === "on"), true)
                    }
                    disabled={busy}
                    icon={Zap}
                    title={t("agent.fastHint")}
                    renderLabel={() => fastMode ? t("agent.fastOn") : t("agent.fastOff")}
                  />
                )}
                {catalog?.supportsContextWindow && (
                  <PillSelect
                    value={contextWindow == null ? "" : String(contextWindow)}
                    options={contextOptions}
                    onChange={(value) =>
                      reconfigure(() => setContextWindow(value ? Number(value) : null))
                    }
                    disabled={busy}
                    icon={Database}
                    title={t("agent.contextWindowHint")}
                    renderLabel={() => contextLabel}
                  />
                )}
                {!catalog?.supportsContextWindow && session?.contextSize && (
                  <span
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[11px] text-ink-2"
                    title={t("agent.contextRuntimeHint")}
                  >
                    <Database className="size-3" /> {contextLabel}
                  </span>
                )}
                {(conversationUsage || conversationCost) && (
                  <span
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[11px] text-ink-2"
                    title={conversationUsageHint}
                  >
                    <Activity className="size-3" /> {conversationUsageLabel}
                  </span>
                )}
                {usageTargetId && (
                  <PillSelect
                    value="refresh"
                    options={usageOptions}
                    onChange={() => void queryUsage(usageTargetId)}
                    disabled={usageLoading}
                    icon={usageLoading ? Loader2 : Activity}
                    title={usage?.detail || t("agent.usageHint")}
                    renderLabel={() => usageLabel}
                  />
                )}
                {!conversationStarted && showProvider && providerOptions.length > 1 && (
                  <PillSelect
                    value={providerId ?? ""}
                    options={providerOptions}
                    onChange={(v) => setProviderId(v || null)}
                    disabled={running}
                    title={t("agent.providerHint")}
                    className="min-w-0"
                  />
                )}
              </>
            )}
          </div>
          <div className="shrink-0">
            {busy ? (
              <div className="flex items-center gap-1">
                {hasInput && (
                  <>
                    <button
                      type="button"
                      onClick={() => void submit(undefined, "send")}
                      title={t("agent.queuePrompt")}
                      className="grid size-7 place-items-center rounded-full border border-line bg-raised text-ink transition-colors hover:border-line-strong"
                    >
                      <ListPlus className="size-3.5" strokeWidth={1.7} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void submit(undefined, "redirect")}
                      title={t("agent.redirectPrompt")}
                      className="grid size-7 place-items-center rounded-full border border-accent/30 bg-accent-soft text-accent transition-colors hover:border-accent/60"
                    >
                      <CornerUpRight className="size-3.5" strokeWidth={1.8} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => void cancel()}
                  title={t("agent.cancel")}
                  className="grid size-7 place-items-center rounded-full border border-line bg-raised text-ink transition-colors hover:border-line-strong"
                >
                  <Square className="size-3 fill-current" strokeWidth={1.6} />
                </button>
              </div>
            ) : (
              <button
                type="submit"
                disabled={!hasInput || (!canSend && (!canCompose || running))}
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
