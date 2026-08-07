import {
  AppWindow,
  ArrowUpRight,
  Download,
  FileText,
  FolderOpen,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import GlyphMark from "@/app/GlyphMark";
import { openAgentsWindow } from "@/lib/agentWindow";
import { useOnboardingStore } from "@/lib/stores/onboardingStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useUiStore } from "@/lib/stores/uiStore";
import { openProjectPath, pickFile, pickProject } from "@/lib/workspaceActions";

function ActionCard({
  icon: Icon,
  label,
  hint,
  onClick,
  accent,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  onClick?: () => void;
  accent?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group flex items-center gap-3 rounded-xl border p-3 text-left transition-all duration-150 ${
        disabled
          ? "cursor-default border-line bg-raised/30 opacity-60"
          : "border-line bg-raised/55 hover:-translate-y-px hover:border-line-strong hover:bg-raised hover:shadow-[var(--shadow-soft)]"
      }`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-[10px] ${
          accent ? "bg-accent-soft text-accent" : "bg-hover text-ink-2"
        }`}
      >
        <Icon className="size-4" strokeWidth={1.7} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">{hint}</span>
      </span>
    </button>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block size-1.5 rounded-full ${ok ? "bg-ok" : "bg-ink-3/40"}`} />;
}

/** Windows canonical paths carry a `\\?\` prefix — noise for humans. */
const prettyPath = (path: string) => path.replace(/^\\\\\?\\/, "");

/** Welcome — a calm monochrome first screen. */
export default function WelcomeHome() {
  const { t } = useTranslation();
  const recents = useProjectStore((s) => s.recents);
  const loadRecents = useProjectStore((s) => s.loadRecents);
  const openOnboarding = useOnboardingStore((s) => s.openOnboarding);
  const refreshEnv = useOnboardingStore((s) => s.refresh);
  const runtime = useOnboardingStore((s) => s.runtime);
  const agents = useOnboardingStore((s) => s.agents);

  useEffect(() => {
    void loadRecents();
    void refreshEnv();
  }, [loadRecents, refreshEnv]);

  const unsavedPrompt = t("menu.unsavedProject");

  const envChips: { name: string; ok: boolean }[] = [
    { name: "Node", ok: !!runtime?.node.installed },
    { name: "Git", ok: !!runtime?.git.installed },
    ...agents
      .filter((a) => a.backend !== "custom-agent")
      .slice(0, 4)
      .map((a) => ({
        name:
          a.backend === "codex-acp"
            ? "Codex"
            : a.backend === "claude-acp"
              ? "Claude"
              : a.backend === "pi-agent"
                ? "Pi"
                : a.backend === "opencode-acp"
                  ? "OpenCode"
                : a.backend,
        ok: a.installed,
      })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-8 py-12">
      <div className="my-auto w-full max-w-[560px]">
        {/* Hero */}
        <div className="rise-in flex flex-col items-center">
          <GlyphMark size={52} />
          <h1 className="mt-4 text-[24px] font-semibold tracking-tight text-ink">
            {t("app.name")}
          </h1>
          <p className="mt-1 text-[12px] text-ink-3">{t("home.tagline")}</p>
        </div>

        {/* Primary actions */}
        <div className="rise-in mt-8 grid grid-cols-2 gap-2.5" style={{ animationDelay: "60ms" }}>
          <ActionCard
            icon={FolderOpen}
            label={t("home.openProject")}
            hint={`${t("home.openProjectHint")} · Ctrl+O`}
            accent
            onClick={() => void pickProject(t("empty.openFolder"), unsavedPrompt)}
          />
          <ActionCard
            icon={FileText}
            label={t("menu.openFile")}
            hint="Ctrl+Shift+O"
            onClick={() => void pickFile(t("menu.openFile"), unsavedPrompt)}
          />
          <ActionCard
            icon={AppWindow}
            label={t("home.agentsWindow")}
            hint={t("home.agentsWindowHint")}
            onClick={() => void openAgentsWindow()}
          />
          <ActionCard icon={Download} label={t("home.cloneRepo")} hint={t("home.soon")} disabled />
          <ActionCard icon={Terminal} label={t("home.connectSsh")} hint={t("home.soon")} disabled />
        </div>

        {/* Recents */}
        <div
          className="rise-in mt-6 overflow-hidden rounded-xl border border-line bg-panel/60"
          style={{ animationDelay: "120ms" }}
        >
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
            <span className="text-[11px] font-medium text-ink-2">{t("home.recentProjects")}</span>
            <div className="flex items-center gap-2 text-[10px]">
              <button
                type="button"
                onClick={() => openOnboarding()}
                className="text-ink-3 transition-colors hover:text-ink-2"
              >
                {t("home.setup")}
              </button>
              <span className="text-line-strong">·</span>
              <button
                type="button"
                onClick={() => useUiStore.getState().openSettings()}
                className="text-ink-3 transition-colors hover:text-ink-2"
              >
                {t("rail.settings")}
              </button>
            </div>
          </div>
          {recents.length === 0 ? (
            <p className="px-3.5 py-4 text-[11px] text-ink-3">{t("home.recentEmpty")}</p>
          ) : (
            <ul className="py-1">
              {recents.slice(0, 6).map((project) => (
                <li key={project.path}>
                  <button
                    type="button"
                    onClick={() => void openProjectPath(project.path, unsavedPrompt)}
                    className="group flex w-full items-baseline gap-2.5 px-3.5 py-[7px] text-left transition-colors hover:bg-hover"
                  >
                    <span className="min-w-0 shrink-0 truncate text-[12px] text-ink">
                      {project.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">
                      {prettyPath(project.path)}
                    </span>
                    <ArrowUpRight className="size-3 shrink-0 self-center text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Environment + shortcuts */}
        <div
          className="rise-in mt-4 flex flex-wrap items-center justify-center gap-1.5"
          style={{ animationDelay: "180ms" }}
        >
          {envChips.map((chip) => (
            <span
              key={chip.name}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised/40 px-2.5 py-1 text-[10.5px] text-ink-2"
            >
              <StatusDot ok={chip.ok} />
              {chip.name}
            </span>
          ))}
          <span className="mx-1 text-line-strong">·</span>
          <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-3">
            <kbd>Ctrl K</kbd>
            {t("titlebar.palette")}
          </span>
        </div>
      </div>
    </div>
  );
}
