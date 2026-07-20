import { GitPullRequestArrow, Languages, Moon, Sun, TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ipc } from "@/lib/ipc/ipc";
import { useReviewStore } from "@/lib/stores/reviewStore";
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
  const turnCount = useReviewStore((s) => s.turns.length);

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
      <span className="text-ink-3/60">{t("app.prealpha")}</span>
      <div className="flex-1" />
      <button type="button" onClick={() => openReview()} title={t("review.title")} className={item}>
        <GitPullRequestArrow className="size-3" />
        {turnCount > 0 ? (
          <span className="inline-flex min-w-[14px] items-center justify-center rounded-full bg-accent-soft px-1 text-[10px] font-medium text-accent">
            {turnCount}
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
