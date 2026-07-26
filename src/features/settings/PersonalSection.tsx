import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "@/lib/ipc/ipc";
import { usePrefsStore } from "@/lib/stores/prefsStore";
import { useUiStore, type Theme } from "@/lib/stores/uiStore";

import { ChoiceRow, ToggleRow } from "./SettingsField";

export default function PersonalSection() {
  const { t, i18n } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const openAgentOnProject = usePrefsStore((s) => s.openAgentOnProject);
  const setPref = usePrefsStore((s) => s.setPref);
  const persist = usePrefsStore((s) => s.persist);
  const customTheme = usePrefsStore((s) => s.customTheme);
  const [themeBusy, setThemeBusy] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  const setLanguage = (lang: string) => {
    if (lang !== "en" && lang !== "zh-CN") return;
    void i18n.changeLanguage(lang);
    localStorage.setItem("glyphra.lang", lang);
    persist(theme, lang);
  };

  const importTheme = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "VS Code theme", extensions: ["json", "jsonc"] }],
    });
    if (typeof selected !== "string") return;
    setThemeBusy(true);
    setThemeError(null);
    try {
      const imported = await ipc.themeImportVsCode(selected);
      const base = imported.base === "light" ? "light" : "dark";
      setTheme(base);
      setPref("customTheme", imported);
      persist(base, i18n.language);
    } catch (error) {
      setThemeError(error instanceof Error ? error.message : String(error));
    } finally {
      setThemeBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-[11px] font-medium text-ink-2">{t("settings.theme")}</div>
        <ChoiceRow
          value={theme}
          onChange={(v) => {
            const next = v as Theme;
            setPref("customTheme", null);
            setTheme(next);
            persist(next, i18n.language);
          }}
          options={[
            { value: "light", label: t("settings.light") },
            { value: "dark", label: t("settings.dark") },
          ]}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={themeBusy}
            onClick={() => void importTheme()}
            className="h-7 flex-1 rounded-md border border-line px-2 text-[10.5px] text-ink-2 hover:border-line-strong disabled:opacity-50"
          >
            {themeBusy ? t("settings.loading") : t("settings.importVsCodeTheme")}
          </button>
          {customTheme && (
            <button
              type="button"
              onClick={() => setPref("customTheme", null)}
              className="h-7 rounded-md border border-line px-2 text-[10.5px] text-ink-3 hover:text-danger"
            >
              {t("settings.removeTheme")}
            </button>
          )}
        </div>
        {customTheme && (
          <p className="mt-1 truncate text-[10px] text-ink-3">
            {t("settings.importedTheme", { name: customTheme.name })}
          </p>
        )}
        {themeError && <p className="mt-1 text-[10px] text-danger">{themeError}</p>}
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
