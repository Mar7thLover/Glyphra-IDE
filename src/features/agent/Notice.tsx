import type { ReactNode } from "react";

/** Compact inline notice card used by both agent surfaces (panel + window). */
export default function Notice({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "danger";
  children: ReactNode;
}) {
  return (
    <div
      className={`mx-3 mt-2 flex items-start justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
        tone === "danger"
          ? "border-danger/25 bg-danger/8 text-danger"
          : "border-line bg-raised/40 text-ink-3"
      }`}
    >
      {children}
    </div>
  );
}
