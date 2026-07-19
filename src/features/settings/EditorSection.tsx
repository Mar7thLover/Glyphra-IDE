import { useTranslation } from "react-i18next";

import { usePrefsStore } from "@/lib/stores/prefsStore";

import { SettingsField, SettingsSelect, ToggleRow } from "./SettingsField";

export default function EditorSection() {
  const { t } = useTranslation();
  const fontSize = usePrefsStore((s) => s.fontSize);
  const tabSize = usePrefsStore((s) => s.tabSize);
  const wordWrap = usePrefsStore((s) => s.wordWrap);
  const lineNumbers = usePrefsStore((s) => s.lineNumbers);
  const setPref = usePrefsStore((s) => s.setPref);
  const resetEditor = usePrefsStore((s) => s.resetEditor);

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
      </div>

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
