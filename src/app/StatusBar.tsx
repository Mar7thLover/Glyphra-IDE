import { GitBranch, GitPullRequestArrow, Languages, Moon, Sun, TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ipc } from "@/lib/ipc/ipc";
import { useGitStore } from "@/lib/stores/gitStore";
import { unresolvedReviewGroupCount, useReviewStore } from "@/lib/stores/reviewStore";
import { useProjectStore } from "@/lib/stores/projectStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useUiStore, type Theme } from "@/lib/stores/uiStore";

function persist(theme: Theme, language: string) {
  if (language !== "en" && language !== "zh-CN") return;
  void ipc.settingsSet({ theme, language });
}

export default function StatusBar() {
  const { t, i18n } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const toggleTerminal = useTerminalStore((s) => s.toggle);
  const openReview = useReviewStore((s) => s.openReview);
  const turns = useReviewStore((s) => s.turns);
  const workingTree = useReviewStore((s) => s.workingTree);
  const decisions = useReviewStore((s) => s.decisions);
  const projectPath = useProjectStore((s) => s.current?.path);
  const branch = useGitStore((s) => s.branch);
  const unresolved = unresolvedReviewGroupCount({ turns, workingTree, decisions });

  const toggleLang = () => {
    const next = i18n.language === "zh-CN" ? "en" : "zh-CN";
    void i18n.changeLanguage(next);
    localStorage.setItem("glyphra.lang", next);
    persist(theme, next);
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    persist(next, i18n.language);
  };

  const item =
    "flex h-full items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-hover hover:text-ink-2";

  return (
    <footer className="glass-panel flex h-6 shrink-0 items-center gap-1 border-t border-line px-2 text-[11px] text-ink-3">
      <span className="inline-flex items-center gap-1.5 px-1">
        <span className="size-1.5 rounded-full bg-ok/80" />
        {t("status.ready")}
      </span>
      {branch && (
        <span
          className="inline-flex items-center gap-1 px-1 font-mono text-[10.5px] text-ink-2"
          title={branch.upstream ? `${branch.name} ↔ ${branch.upstream}` : branch.name}
        >
          <GitBranch className="size-3 text-ink-3" />
          {branch.name}
          {(branch.ahead > 0 || branch.behind > 0) && (
            <span className="text-ink-3">
              {branch.ahead > 0 && <span className="text-ok">↑{branch.ahead}</span>}
              {branch.behind > 0 && <span className="text-danger">↓{branch.behind}</span>}
            </span>
          )}
        </span>
      )}
      <span className="text-ink-3/60">{t("app.prealpha")}</span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => openReview(projectPath)}
        title={`${t("review.title")} · Ctrl+Shift+R`}
        className={`${item} relative`}
      >
        <GitPullRequestArrow className="size-3" />
        {unresolved > 0 && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-[#c58a22]" />}
        {unresolved > 0 ? (
          <span className="inline-flex min-w-[14px] items-center justify-center rounded-full bg-accent-soft px-1 text-[10px] font-medium text-accent">
            {unresolved}
          </span>
        ) : (
          t("review.title")
        )}
      </button>
      <button
        type="button"
        onClick={() => toggleTerminal()}
        title={t("terminal.title")}
        className={item}
      >
        <TerminalSquare className="size-3" />
        {t("terminal.title")}
      </button>
      <button onClick={toggleLang} title={t("settings.language")} className={item}>
        <Languages className="size-3" />
        {i18n.language === "zh-CN" ? "中文" : "EN"}
      </button>
      <button onClick={toggleTheme} title={t("settings.theme")} className={item}>
        {theme === "dark" ? <Moon className="size-3" /> : <Sun className="size-3" />}
      </button>
    </footer>
  );
}
