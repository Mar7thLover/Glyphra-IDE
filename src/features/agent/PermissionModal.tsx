import { ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { PermissionPrompt } from "@/lib/acp/types";

interface PermissionModalProps {
  prompt: PermissionPrompt;
  onRespond: (optionId: string | "cancelled") => void;
}

export default function PermissionModal({ prompt, onRespond }: PermissionModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onRespond("cancelled");
        return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < prompt.options.length) {
        onRespond(prompt.options[index]!.optionId);
      }
      if (event.key.toLowerCase() === "y" && prompt.options[0]) {
        onRespond(prompt.options[0].optionId);
      }
      if (event.key.toLowerCase() === "n") {
        const reject = prompt.options.find((option) => option.kind.startsWith("reject"));
        onRespond(reject?.optionId ?? "cancelled");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRespond, prompt.options]);

  return (
    <div className="absolute inset-0 z-20 grid place-items-end bg-app/55 p-3 backdrop-blur-[1px]">
      <div className="w-full rounded-xl border border-line bg-raised p-3 shadow-lg">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
          <ShieldAlert className="size-4 text-accent" />
          {t("agent.permissionTitle")}
        </div>
        <p className="mb-3 text-xs text-ink-2">{prompt.title}</p>
        <div className="flex flex-col gap-1.5">
          {prompt.options.map((option, index) => (
            <button
              key={option.optionId}
              onClick={() => onRespond(option.optionId)}
              className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-left text-xs text-ink-2 transition-colors hover:border-accent hover:text-ink"
            >
              <span className="mr-2 font-mono text-[10px] text-ink-3">{index + 1}</span>
              {option.name}
            </button>
          ))}
          <button
            onClick={() => onRespond("cancelled")}
            className="rounded-lg px-2.5 py-1.5 text-left text-[11px] text-ink-3 hover:text-ink-2"
          >
            {t("agent.permissionCancel")} <span className="font-mono">Esc</span>
          </button>
        </div>
      </div>
    </div>
  );
}
