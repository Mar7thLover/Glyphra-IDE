import { useState } from "react";
import { useTranslation } from "react-i18next";

import { persistEditorRecovery } from "@/lib/editorRecovery";
import { ipc, type ResourceCounts } from "@/lib/ipc/ipc";
import { isEditorTabDirty, useEditorStore } from "@/lib/stores/editorStore";
import { useProjectStore } from "@/lib/stores/projectStore";

export default function FaultDrillPanel() {
  const { t } = useTranslation();
  const [throwRenderError, setThrowRenderError] = useState(false);
  const [counts, setCounts] = useState<ResourceCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!import.meta.env.DEV) return null;
  if (throwRenderError) {
    throw new Error("Intentional Glyphra React render fault drill");
  }

  const runRecoveryDrill = async () => {
    const projectPath = useProjectStore.getState().current?.path;
    const hasDirty = useEditorStore.getState().tabs.some(isEditorTabDirty);
    if (!projectPath || !hasDirty) {
      setError(t("settings.faultRecoveryNeedsDirty"));
      return;
    }
    if (!window.confirm(t("settings.faultRecoveryConfirm"))) return;
    const persisted = await persistEditorRecovery(projectPath);
    if (!persisted) {
      setError(t("settings.faultRecoveryFailed"));
      return;
    }
    window.location.reload();
  };

  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-[0.06em] text-danger">
        {t("settings.faultDrillsTitle")}
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-3">
        {t("settings.faultDrillsHint")}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => setThrowRenderError(true)}
          className="h-7 rounded-md border border-danger/30 text-[10px] text-danger"
        >
          {t("settings.faultReact")}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(t("settings.faultRustConfirm"))) return;
            void ipc
              .diagnosticsFaultPanic("GLYPHRA_FAULT_DRILL")
              .catch((fault) => setError(fault instanceof Error ? fault.message : String(fault)));
          }}
          className="h-7 rounded-md border border-danger/30 text-[10px] text-danger"
        >
          {t("settings.faultRust")}
        </button>
        <button
          type="button"
          onClick={() => void runRecoveryDrill()}
          className="h-7 rounded-md border border-line text-[10px] text-ink-2"
        >
          {t("settings.faultRecovery")}
        </button>
        <button
          type="button"
          onClick={() =>
            void ipc
              .diagnosticsResourceCounts()
              .then(setCounts)
              .catch((fault) => setError(fault instanceof Error ? fault.message : String(fault)))
          }
          className="h-7 rounded-md border border-line text-[10px] text-ink-2"
        >
          {t("settings.faultResources")}
        </button>
      </div>
      {counts && (
        <p className="mt-2 font-mono text-[10px] text-ink-3">
          agents={counts.agents} agent-terminals={counts.agentTerminals} ptys={counts.ptys} searches=
          {counts.searches}
        </p>
      )}
      {error && <p className="mt-2 text-[10px] text-danger">{error}</p>}
    </div>
  );
}
