import { Languages, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useUiStore } from "@/lib/stores/uiStore";

export default function StatusBar() {
  const { t, i18n } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const toggleLang = () => {
    const next = i18n.language === "zh-CN" ? "en" : "zh-CN";
    void i18n.changeLanguage(next);
    localStorage.setItem("glyphra.lang", next);
  };

  return (
    <footer className="flex h-6 shrink-0 items-center gap-1 border-t border-line bg-panel px-2 text-[11px] text-ink-3">
      <span className="rounded-sm bg-accent/12 px-1.5 py-px font-medium text-accent">
        {t("app.prealpha")}
      </span>
      <span className="ml-1">{t("status.ready")}</span>
      <div className="flex-1" />
      <button
        onClick={toggleLang}
        title={t("settings.language")}
        className="flex h-full items-center gap-1 rounded-sm px-1.5 transition-colors hover:bg-hover hover:text-ink-2"
      >
        <Languages className="size-3" />
        {i18n.language === "zh-CN" ? "中文" : "EN"}
      </button>
      <button
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        title={t("settings.theme")}
        className="flex h-full items-center rounded-sm px-1.5 transition-colors hover:bg-hover hover:text-ink-2"
      >
        {theme === "dark" ? <Moon className="size-3" /> : <Sun className="size-3" />}
      </button>
    </footer>
  );
}
