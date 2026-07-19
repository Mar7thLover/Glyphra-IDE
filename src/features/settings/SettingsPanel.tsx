import { Languages, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ipc, type AppSettings } from "@/lib/ipc/ipc";
import { useUiStore, type Theme } from "@/lib/stores/uiStore";

import ProvidersSection from "./ProvidersSection";

const themeOptions: Theme[] = ["light", "dark"];
const languageOptions: { value: AppSettings["language"]; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];

function persistSettings(theme: Theme, language: string) {
  if (language !== "en" && language !== "zh-CN") return;
  void ipc.settingsSet({ theme, language });
}

export default function SettingsPanel() {
  const { t, i18n } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const setLanguage = (lang: AppSettings["language"]) => {
    if (lang === "system") return;
    void i18n.changeLanguage(lang);
    localStorage.setItem("glyphra.lang", lang);
    persistSettings(theme, lang);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-2">
      <section className="rounded-xl border border-line bg-raised/55 p-3 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium text-ink-2">
          <Moon className="size-3.5" />
          {t("settings.theme")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {themeOptions.map((option) => {
            const active = option === theme;
            return (
              <button
                key={option}
                onClick={() => {
                  setTheme(option);
                  persistSettings(option, i18n.language);
                }}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all ${
                  active
                    ? "border-accent bg-accent text-accent-ink shadow-sm"
                    : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink"
                }`}
              >
                {option === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
                {t(`settings.${option}`)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-raised/55 p-3 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-xs font-medium text-ink-2">
          <Languages className="size-3.5" />
          {t("settings.language")}
        </div>
        <div className="flex flex-col gap-2">
          {languageOptions.map((option) => {
            const active = option.value === i18n.language;
            return (
              <button
                key={option.value}
                onClick={() => setLanguage(option.value)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                  active
                    ? "border-accent bg-accent/12 text-accent"
                    : "border-line bg-panel text-ink-2 hover:border-line-strong hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </section>

      <ProvidersSection />
    </div>
  );
}
