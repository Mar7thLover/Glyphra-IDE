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
        return;
      }
      if (event.key.toLowerCase() === "y") {
        const allow =
          prompt.options.find((option) => option.kind.startsWith("allow")) ?? prompt.options[0];
        if (allow) onRespond(allow.optionId);
      }
      if (event.key.toLowerCase() === "n") {
        const reject = prompt.options.find((option) => option.kind.startsWith("reject"));
        onRespond(reject?.optionId ?? "cancelled");
      }
      if (event.key.toLowerCase() === "a") {
        const always =
          prompt.options.find(
            (option) =>
              option.kind === "allow_always" ||
              option.kind.includes("always") ||
              /always/i.test(option.name),
          ) ?? prompt.options.find((option) => option.kind.startsWith("allow"));
        if (always) onRespond(always.optionId);
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
        <p className="mb-1 text-xs text-ink-2">{prompt.title}</p>
        {(prompt.kind || prompt.toolCallId || (prompt.locations && prompt.locations.length > 0)) && (
          <div className="mb-3 space-y-0.5 font-mono text-[10px] text-ink-3">
            {prompt.kind && <div>{prompt.kind}</div>}
            {prompt.locations?.map((path) => (
              <div key={path} className="truncate">
                {path}
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {prompt.options.map((option, index) => {
            const isAllow = option.kind.startsWith("allow");
            const isReject = option.kind.startsWith("reject");
            return (
              <button
                key={option.optionId}
                type="button"
                onClick={() => onRespond(option.optionId)}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                  isAllow
                    ? "border-accent/40 bg-accent/10 text-ink hover:border-accent"
                    : isReject
                      ? "border-danger/30 bg-danger/5 text-ink-2 hover:border-danger/50"
                      : "border-line bg-panel text-ink-2 hover:border-accent hover:text-ink"
                }`}
              >
                <span className="mr-2 font-mono text-[10px] text-ink-3">{index + 1}</span>
                {option.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => onRespond("cancelled")}
            className="rounded-lg px-2.5 py-1.5 text-left text-[11px] text-ink-3 hover:text-ink-2"
          >
            {t("agent.permissionCancel")} <span className="font-mono">Esc</span>
          </button>
        </div>
        <p className="mt-2 text-[10px] text-ink-3">{t("agent.permissionHint")}</p>
      </div>
    </div>
  );
}
