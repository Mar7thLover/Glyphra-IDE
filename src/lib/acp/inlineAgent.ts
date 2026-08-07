import { AgentBus } from "@/lib/acp/bus";
import type {
  AgentStartOptions,
  AgentTimelineItem,
  CustomAgentProtocol,
} from "@/lib/acp/types";
import { useAgentStore } from "@/lib/stores/agentStore";
import { useHarnessStore } from "@/lib/stores/harnessStore";
import { useProjectStore } from "@/lib/stores/projectStore";

/**
 * A hidden, single-purpose agent session used by Ctrl+K inline edits and ghost
 * text.
 *
 * It deliberately does not reuse the conversation the user can see: inline
 * requests must not appear in the chat timeline, must not inherit its queued
 * turns, and must never run a tool. The session is started lazily on the first
 * request, kept warm for the project, and torn down when the project changes or
 * the window unloads.
 */

export class InlineAgentUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InlineAgentUnavailable";
  }
}

/** Thrown when a newer request superseded this one, or the user dismissed it. */
export class InlineAgentCancelled extends Error {
  constructor() {
    super("Inline request cancelled");
    this.name = "InlineAgentCancelled";
  }
}

function assistantTextAfter(items: AgentTimelineItem[], from: number): string {
  return items
    .slice(from)
    .filter((item): item is Extract<AgentTimelineItem, { kind: "assistant" }> =>
      item.kind === "assistant",
    )
    .map((item) => item.text)
    .join("")
    .trim();
}

/**
 * Ctrl+K and ghost text share one subprocess but must not cancel each other, so
 * every request carries a lane and cancellation is scoped to it.
 */
export type InlineAgentLane = "edit" | "ghost";

/**
 * Turns to reuse a hidden session for before recycling it.
 *
 * Every inline request carries its own surrounding code, so accumulated history
 * is pure overhead: it grows the harness's context (and its cost) and inflates
 * the timeline this class holds in memory. Restarting costs one process spawn
 * per N edits, which is the cheaper side of the trade.
 */
const MAX_SESSION_TURNS = 8;

class InlineAgentRunner {
  private bus: AgentBus | null = null;
  private busProject: string | null = null;
  private starting: Promise<AgentBus> | null = null;
  private unsubscribe: (() => void) | null = null;
  /** Serializes requests — one hidden session answers one turn at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  private generations = new Map<InlineAgentLane, number>();
  private activeLane: InlineAgentLane | null = null;
  private turns = 0;

  /**
   * Drop the lane's in-flight request. The subprocess stays warm; only the
   * current turn is abandoned so a newer keystroke can take its place.
   */
  cancel(lane: InlineAgentLane) {
    this.bump(lane);
    if (this.activeLane === lane) {
      this.activeLane = null;
      void this.bus?.cancel().catch(() => undefined);
    }
  }

  /** Tear the hidden session down (project switch, window unload, pref off). */
  async dispose() {
    this.bump("edit");
    this.bump("ghost");
    this.activeLane = null;
    const bus = this.bus;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.bus = null;
    this.busProject = null;
    this.starting = null;
    if (bus) await bus.stop().catch(() => undefined);
  }

  private bump(lane: InlineAgentLane) {
    const next = (this.generations.get(lane) ?? 0) + 1;
    this.generations.set(lane, next);
    return next;
  }

  /**
   * Run one prompt against the hidden session and resolve with the assistant
   * text it produced. Requests are serialized; a request that is superseded
   * before it completes rejects with {@link InlineAgentCancelled}.
   */
  async run(
    projectPath: string,
    prompt: string,
    lane: InlineAgentLane = "edit",
  ): Promise<string> {
    const ticket = this.bump(lane);
    const current = () => this.generations.get(lane) === ticket;
    const result = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (!current()) throw new InlineAgentCancelled();
        const bus = await this.ensureSession(projectPath);
        if (!current()) throw new InlineAgentCancelled();
        const before = bus.getSession()?.items.length ?? 0;
        this.activeLane = lane;
        this.turns += 1;
        try {
          await bus.prompt(prompt, { displayText: prompt });
        } finally {
          if (this.activeLane === lane) this.activeLane = null;
        }
        if (!current()) throw new InlineAgentCancelled();
        const items = bus.getSession()?.items ?? [];
        return assistantTextAfter(items, before);
      });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async ensureSession(projectPath: string): Promise<AgentBus> {
    if (this.bus && this.busProject === projectPath && this.turns < MAX_SESSION_TURNS) {
      const status = this.bus.getSession()?.status;
      if (status && status !== "exited" && status !== "crashed") return this.bus;
      await this.dispose();
    } else if (this.bus) {
      await this.dispose();
    }
    if (this.starting) return this.starting;

    this.starting = this.startSession(projectPath).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async startSession(projectPath: string): Promise<AgentBus> {
    const initial = useAgentStore.getState();
    if (initial.backend === "auto" || initial.backends.length === 0) {
      // detect() resolves "auto" to a concrete installed harness.
      await useAgentStore.getState().detect();
    }
    const { backend, backends, providerId, model, contextWindow } =
      useAgentStore.getState();
    const custom = backend.startsWith("custom:")
      ? useHarnessStore
          .getState()
          .harnesses.find((item) => `custom:${item.id}` === backend)
      : null;
    const info = backends.find((item) => item.backend === backend);
    if (!custom && !info) {
      throw new InlineAgentUnavailable(
        "No agent harness is configured for inline editing.",
      );
    }
    if (info && !info.installed) {
      throw new InlineAgentUnavailable(`${backend} is not installed. ${info.detail}`);
    }

    const options: AgentStartOptions = {
      // Inline edits are pure text transformations. Safe mode plus the
      // auto-deny below guarantees a stray tool call cannot touch the disk.
      mode: "safe",
      providerId,
      model,
      contextWindow,
      fastMode: true,
      approvalReviewer: "user",
      harness: custom
        ? {
            protocol: custom.protocol,
            command: custom.command || null,
            args: custom.args,
            env: custom.env,
            endpoint: custom.endpoint ?? null,
            model: custom.model ?? null,
          }
        : info
          ? {
              protocol: info.protocol as CustomAgentProtocol,
              command: info.command,
              args: info.args,
            }
          : undefined,
    };

    const bus = new AgentBus();
    this.unsubscribe = bus.subscribe((session) => {
      // No UI exists for the hidden session, so a permission prompt would hang
      // the turn forever. Refuse it and let the prompt fail fast instead.
      if (session.permission) bus.respondPermission("cancelled");
    });
    try {
      await bus.start(backend, projectPath, options);
    } catch (error) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      await bus.stop().catch(() => undefined);
      throw error instanceof Error
        ? new InlineAgentUnavailable(error.message)
        : new InlineAgentUnavailable(String(error));
    }
    this.bus = bus;
    this.busProject = projectPath;
    this.turns = 0;
    return bus;
  }
}

export const inlineAgent = new InlineAgentRunner();

// The hidden harness is started with the project as its cwd, so a project
// switch has to retire it. Subscribing here (rather than calling out from
// projectStore) keeps the dependency one-directional.
let lastProjectPath = useProjectStore.getState().current?.path ?? null;
useProjectStore.subscribe((state) => {
  const path = state.current?.path ?? null;
  if (path === lastProjectPath) return;
  lastProjectPath = path;
  void inlineAgent.dispose();
});

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    void inlineAgent.dispose();
  });
}
