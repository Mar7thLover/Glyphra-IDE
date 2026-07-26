import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  normalizeShortcut,
  shortcutFromEvent,
} from "@/lib/keybindings";
import { usePrefsStore } from "@/lib/stores/prefsStore";

const COMMANDS = [
  "workbench.commands",
  "workbench.quickOpen",
  "workbench.openFolder",
  "workbench.openFile",
  "editor.goToSymbol",
  "workbench.toggleAgent",
  "workbench.settings",
  "workbench.toggleTerminal",
  "workbench.search",
  "workbench.review",
  "editor.inlineEdit",
  "editor.save",
  "editor.close",
  "editor.nextTab",
] as const;

export default function KeybindingsSection() {
  const { t } = useTranslation();
  const keybindings = usePrefsStore((state) => state.keybindings);
  const setPref = usePrefsStore((state) => state.setPref);
  const resetKeybindings = usePrefsStore((state) => state.resetKeybindings);
  const [recording, setRecording] = useState<number | null>(null);

  const conflicts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const binding of keybindings) {
      const key = `${normalizeShortcut(binding.key)}|${binding.when ?? ""}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [keybindings]);

  const update = (index: number, patch: Partial<(typeof keybindings)[number]>) => {
    setPref(
      "keybindings",
      keybindings.map((binding, bindingIndex) =>
        bindingIndex === index ? { ...binding, ...patch } : binding,
      ),
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] leading-relaxed text-ink-3">
          {t("settings.keybindingsHint")}
        </p>
        <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
          {t("settings.whenHint")}
        </p>
      </div>

      <div className="space-y-2">
        {keybindings.map((binding, index) => {
          const conflictKey = `${normalizeShortcut(binding.key)}|${binding.when ?? ""}`;
          const conflict = (conflicts.get(conflictKey) ?? 0) > 1;
          return (
            <div
              key={`${binding.command}-${index}`}
              className={`rounded-lg border p-2.5 ${
                conflict ? "border-danger/50 bg-danger/5" : "border-line"
              }`}
            >
              <div className="flex items-center gap-2">
                <select
                  aria-label={t("settings.keybindingCommand")}
                  value={binding.command}
                  onChange={(event) => update(index, { command: event.target.value })}
                  className="h-7 min-w-0 flex-1 rounded-md border border-line bg-raised px-2 text-[10.5px] text-ink outline-none"
                >
                  {COMMANDS.map((command) => (
                    <option key={command} value={command}>
                      {t(`settings.commands.${command}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-pressed={recording === index}
                  onClick={() => setRecording(index)}
                  onKeyDown={(event) => {
                    if (recording !== index) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setRecording(null);
                      return;
                    }
                    const shortcut = shortcutFromEvent(event.nativeEvent);
                    if (!shortcut) return;
                    update(index, { key: shortcut });
                    setRecording(null);
                  }}
                  className={`h-7 min-w-[104px] rounded-md border px-2 font-mono text-[10px] ${
                    recording === index
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-raised text-ink-2"
                  }`}
                >
                  {recording === index ? t("settings.pressShortcut") : binding.key}
                </button>
                <button
                  type="button"
                  aria-label={t("settings.removeKeybinding")}
                  onClick={() =>
                    setPref(
                      "keybindings",
                      keybindings.filter((_, bindingIndex) => bindingIndex !== index),
                    )
                  }
                  className="grid size-7 place-items-center rounded-md border border-line text-ink-3 hover:text-danger"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              <input
                value={binding.when ?? ""}
                onChange={(event) => update(index, { when: event.target.value || null })}
                placeholder={t("settings.whenPlaceholder")}
                aria-label={t("settings.whenClause")}
                className="mt-2 h-7 w-full rounded-md border border-line bg-raised px-2 font-mono text-[10px] text-ink outline-none placeholder:text-ink-3"
              />
              {conflict && (
                <p className="mt-1 text-[10px] text-danger">
                  {t("settings.keybindingConflict")}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            setPref("keybindings", [
              ...keybindings,
              { command: "workbench.commands", key: "Ctrl+Alt+K", when: null },
            ])
          }
          className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-line text-[10.5px] text-ink-2 hover:border-line-strong"
        >
          <Plus className="size-3" />
          {t("settings.addKeybinding")}
        </button>
        <button
          type="button"
          onClick={resetKeybindings}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border border-line text-[10.5px] text-ink-2 hover:border-line-strong"
        >
          <RotateCcw className="size-3" />
          {t("settings.resetKeybindings")}
        </button>
      </div>
    </div>
  );
}
