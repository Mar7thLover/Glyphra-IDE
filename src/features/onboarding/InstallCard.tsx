import { CheckCircle2, CircleDashed, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { InstallGuide } from "./installGuides";

interface InstallCardProps {
  guide: InstallGuide;
  installed: boolean;
  detail?: string;
}

export default function InstallCard({ guide, installed, detail }: InstallCardProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(command);
      window.setTimeout(() => setCopied(null), 1200);
    } catch {
      // clipboard may be unavailable in some WebView contexts
    }
  };

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        installed ? "border-accent/35 bg-accent/8" : "border-line bg-raised/60"
      }`}
    >
      <div className="flex items-start gap-2">
        {installed ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" />
        ) : (
          <CircleDashed className="mt-0.5 size-4 shrink-0 text-ink-3" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold text-ink">{guide.title}</h3>
            {guide.required && (
              <span className="rounded bg-panel px-1.5 py-px text-[10px] uppercase tracking-wide text-ink-3">
                {t("onboarding.required")}
              </span>
            )}
            <span className={`text-[10px] ${installed ? "text-accent" : "text-ink-3"}`}>
              {installed ? t("onboarding.found") : t("onboarding.missing")}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{guide.summary}</p>
          {detail && <p className="mt-1 truncate font-mono text-[10px] text-ink-2">{detail}</p>}

          {!installed && (
            <div className="mt-2 space-y-1.5">
              {guide.commands.map((entry) => (
                <div
                  key={entry.command}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1"
                >
                  <span className="shrink-0 text-[10px] text-ink-3">{entry.label}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-2">
                    {entry.command}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy(entry.command)}
                    className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink"
                    title={t("onboarding.copy")}
                  >
                    <Copy className="size-3" />
                  </button>
                </div>
              ))}
              {copied && (
                <p className="text-[10px] text-accent">{t("onboarding.copied")}</p>
              )}
            </div>
          )}

          {guide.docsUrl && (
            <a
              href={guide.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[10px] text-accent hover:underline"
            >
              {t("onboarding.docs")}
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
