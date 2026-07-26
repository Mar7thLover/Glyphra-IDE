import { SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useState } from "react";

/**
 * A switch the user made mid-conversation, or a failure worth keeping in the
 * transcript. Renders as a seam between turns rather than as a message.
 */
export default function SystemNote({
  texts,
  tone,
}: {
  texts: string[];
  tone: "config" | "alert";
}) {
  const [expanded, setExpanded] = useState(false);
  const extra = texts.length - 1;
  const alert = tone === "alert";
  const Icon = alert ? TriangleAlert : SlidersHorizontal;

  return (
    <div className="px-3.5 py-1.5">
      <div className="flex items-center gap-2">
        <span className={`h-px flex-1 ${alert ? "bg-danger/25" : "bg-line"}`} />
        <button
          type="button"
          disabled={extra <= 0}
          onClick={() => setExpanded((value) => !value)}
          className={`flex min-w-0 max-w-[80%] items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] transition-colors disabled:cursor-default ${
            alert
              ? "text-danger enabled:hover:bg-danger/10"
              : "text-ink-3 enabled:hover:bg-hover enabled:hover:text-ink-2"
          }`}
        >
          <Icon className="size-2.5 shrink-0" strokeWidth={1.8} />
          <span className="truncate">{texts[0]}</span>
          {extra > 0 && (
            <span className="shrink-0 rounded-full bg-hover px-1 font-mono text-[9px]">
              {expanded ? "−" : `+${extra}`}
            </span>
          )}
        </button>
        <span className={`h-px flex-1 ${alert ? "bg-danger/25" : "bg-line"}`} />
      </div>
      {expanded && extra > 0 && (
        <ul
          className={`mt-1 space-y-px text-center text-[10px] leading-relaxed ${
            alert ? "text-danger/80" : "text-ink-3"
          }`}
        >
          {texts.slice(1).map((text, index) => (
            <li key={`${text}-${index}`}>{text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
