import { useTranslation } from "react-i18next";

import { ipc, type AppSettings } from "@/lib/ipc/ipc";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useUiStore, type Theme } from "@/lib/stores/uiStore";

import { ChoiceRow, ToggleRow } from "./SettingsField";

function persistSettings(theme: Theme, language: string) {
  if (language !== "en" && language !== "zh-CN") return;
  void ipc.settingsSet({ theme, language });
}

export default function PersonalSection() {
  const { t, i18n } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const openAgentOnProject = usePrefsStore((s) => s.openAgentOnProject);
  const setPref = usePrefsStore((s) => s.setPref);

  const setLanguage = (lang: string) => {
    if (lang !== "en" && lang !== "zh-CN") return;
    void i18n.changeLanguage(lang);
    localStorage.setItem("glyphra.lang", lang);
    persistSettings(theme, lang as AppSettings["language"]);
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-[11px] font-medium text-ink-2">{t("settings.theme")}</div>
        <ChoiceRow
          value={theme}
          onChange={(v) => {
            const next = v as Theme;
            setTheme(next);
            persistSettings(next, i18n.language);
          }}
          options={[
            { value: "light", label: t("settings.light") },
            { value: "dark", label: t("settings.dark") },
          ]}
        />
      </div>

      <div>
        <div className="mb-2 text-[11px] font-medium text-ink-2">{t("settings.language")}</div>
        <ChoiceRow
          value={i18n.language.startsWith("zh") ? "zh-CN" : "en"}
          onChange={setLanguage}
          options={[
            { value: "en", label: "English" },
            { value: "zh-CN", label: "简体中文" },
          ]}
        />
      </div>

      <div className="border-t border-line pt-3">
        <ToggleRow
          label={t("settings.openAgentOnProject")}
          hint={t("settings.openAgentOnProjectHint")}
          checked={openAgentOnProject}
          onChange={(checked) => setPref("openAgentOnProject", checked)}
        />
      </div>
    </div>
  );
}
