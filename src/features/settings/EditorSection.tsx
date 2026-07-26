import { useTranslation } from "react-i18next";

import { LSP_LANGUAGES } from "@/features/editor/lspLanguage";
import { useLspStore } from "@/lib/stores/lspStore";
import { usePrefsStore } from "@/lib/stores/prefsStore";

import { SettingsField, SettingsSelect, ToggleRow } from "./SettingsField";

export default function EditorSection() {
  const { t } = useTranslation();
  const fontSize = usePrefsStore((s) => s.fontSize);
  const tabSize = usePrefsStore((s) => s.tabSize);
  const wordWrap = usePrefsStore((s) => s.wordWrap);
  const lineNumbers = usePrefsStore((s) => s.lineNumbers);
  const trimTrailingWhitespace = usePrefsStore((s) => s.trimTrailingWhitespace);
  const insertFinalNewline = usePrefsStore((s) => s.insertFinalNewline);
  const formatOnSave = usePrefsStore((s) => s.formatOnSave);
  const minimap = usePrefsStore((s) => s.minimap);
  const breadcrumbs = usePrefsStore((s) => s.breadcrumbs);
  const stickyScroll = usePrefsStore((s) => s.stickyScroll);
  const bracketPairColorization = usePrefsStore((s) => s.bracketPairColorization);
  const indentGuides = usePrefsStore((s) => s.indentGuides);
  const ghostText = usePrefsStore((s) => s.ghostText);
  const ghostTextDelayMs = usePrefsStore((s) => s.ghostTextDelayMs);
  const terminalWebgl = usePrefsStore((s) => s.terminalWebgl);
  const languageServer = usePrefsStore((s) => s.languageServer);
  const languageServerDisabled = usePrefsStore((s) => s.languageServerDisabled);
  const lspStatuses = useLspStore((s) => s.statuses);
  const setPref = usePrefsStore((s) => s.setPref);
  const resetEditor = usePrefsStore((s) => s.resetEditor);

  const toggleLanguageServer = (languageId: string, enabled: boolean) => {
    const next = enabled
      ? languageServerDisabled.filter((entry) => entry !== languageId)
      : [...new Set([...languageServerDisabled, languageId])];
    setPref("languageServerDisabled", next);
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-ink-3">{t("settings.editorHint")}</p>

      <SettingsField label={t("settings.fontSize")}>
        <SettingsSelect
          value={String(fontSize)}
          onChange={(v) => setPref("fontSize", Number(v))}
        >
          {[11, 12, 13, 14, 15, 16, 18].map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </SettingsSelect>
      </SettingsField>

      <SettingsField label={t("settings.tabSize")}>
        <SettingsSelect value={String(tabSize)} onChange={(v) => setPref("tabSize", Number(v))}>
          {[2, 4, 8].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </SettingsSelect>
      </SettingsField>

      <div className="space-y-1 border-t border-line pt-3">
        <ToggleRow
          label={t("settings.wordWrap")}
          checked={wordWrap}
          onChange={(checked) => setPref("wordWrap", checked)}
        />
        <ToggleRow
          label={t("settings.lineNumbers")}
          checked={lineNumbers}
          onChange={(checked) => setPref("lineNumbers", checked)}
        />
        <ToggleRow
          label={t("settings.trimTrailingWhitespace")}
          hint={t("settings.trimTrailingWhitespaceHint")}
          checked={trimTrailingWhitespace}
          onChange={(checked) => setPref("trimTrailingWhitespace", checked)}
        />
        <ToggleRow
          label={t("settings.insertFinalNewline")}
          hint={t("settings.insertFinalNewlineHint")}
          checked={insertFinalNewline}
          onChange={(checked) => setPref("insertFinalNewline", checked)}
        />
        <ToggleRow
          label={t("settings.formatOnSave")}
          hint={t("settings.formatOnSaveHint")}
          checked={formatOnSave}
          onChange={(checked) => setPref("formatOnSave", checked)}
        />
        <ToggleRow
          label={t("settings.minimap")}
          hint={t("settings.minimapHint")}
          checked={minimap}
          onChange={(checked) => setPref("minimap", checked)}
        />
        <ToggleRow
          label={t("settings.breadcrumbs")}
          checked={breadcrumbs}
          onChange={(checked) => setPref("breadcrumbs", checked)}
        />
        <ToggleRow
          label={t("settings.stickyScroll")}
          checked={stickyScroll}
          onChange={(checked) => setPref("stickyScroll", checked)}
        />
        <ToggleRow
          label={t("settings.bracketPairColorization")}
          checked={bracketPairColorization}
          onChange={(checked) => setPref("bracketPairColorization", checked)}
        />
        <ToggleRow
          label={t("settings.indentGuides")}
          checked={indentGuides}
          onChange={(checked) => setPref("indentGuides", checked)}
        />
        <ToggleRow
          label={t("settings.ghostText")}
          hint={t("settings.ghostTextHint")}
          checked={ghostText}
          onChange={(checked) => setPref("ghostText", checked)}
        />
        <ToggleRow
          label={t("settings.terminalWebgl")}
          hint={t("settings.terminalWebglHint")}
          checked={terminalWebgl}
          onChange={(checked) => setPref("terminalWebgl", checked)}
        />
      </div>

      {ghostText && (
        <SettingsField label={t("settings.ghostTextDelay")}>
          <SettingsSelect
            value={String(ghostTextDelayMs)}
            onChange={(v) => setPref("ghostTextDelayMs", Number(v))}
          >
            {[250, 400, 600, 1000, 1500].map((delay) => (
              <option key={delay} value={delay}>
                {t("settings.ghostTextDelayValue", { ms: delay })}
              </option>
            ))}
          </SettingsSelect>
        </SettingsField>
      )}

      <div className="space-y-1 border-t border-line pt-3">
        <ToggleRow
          label={t("settings.languageServer")}
          hint={t("settings.languageServerHint")}
          checked={languageServer}
          onChange={(checked) => setPref("languageServer", checked)}
        />
      </div>

      {languageServer && (
        <div className="space-y-1 rounded-lg border border-line px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-[0.06em] text-ink-3">
            {t("settings.languageServerLanguages")}
          </div>
          {LSP_LANGUAGES.map((entry) => {
            const status = lspStatuses[entry.id] ?? null;
            const state =
              status?.state === "ready"
                ? t("settings.languageServerReady")
                : status?.state === "unavailable"
                  ? t("settings.languageServerMissing")
                  : status?.state === "stopped"
                    ? t("settings.languageServerStopped")
                    : t("settings.languageServerIdle");
            return (
              <ToggleRow
                key={entry.id}
                label={`${entry.label} · ${entry.server}`}
                hint={state}
                checked={!languageServerDisabled.includes(entry.id)}
                onChange={(checked) => toggleLanguageServer(entry.id, checked)}
              />
            );
          })}
          <p className="pt-1 text-[10px] leading-relaxed text-ink-3">
            {t("settings.languageServerInstallHint")}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={resetEditor}
        className="text-[11px] text-ink-3 hover:text-ink-2"
      >
        {t("settings.resetEditor")}
      </button>
    </div>
  );
}
