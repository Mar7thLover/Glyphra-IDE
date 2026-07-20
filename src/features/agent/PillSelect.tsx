import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export interface PillOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * Composer pill dropdown — replaces native <select> with a glass popover that
 * opens upward (the composer sits at the bottom of the panel).
 */
export default function PillSelect({
  value,
  options,
  onChange,
  disabled,
  icon: Icon,
  title,
  className,
  renderLabel,
}: {
  value: string;
  options: PillOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  icon?: LucideIcon;
  title?: string;
  className?: string;
  /** Override the collapsed label (e.g. shorten long provider names). */
  renderLabel?: (selected: PillOption | undefined) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-6 max-w-full items-center gap-1 rounded-full border border-line bg-raised/60 pl-2 pr-1.5 text-[11px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40 ${
          open ? "border-line-strong text-ink" : ""
        }`}
      >
        {Icon && <Icon className="size-3 shrink-0 opacity-80" strokeWidth={1.7} />}
        <span className="min-w-0 truncate">
          {renderLabel ? renderLabel(selected) : (selected?.label ?? "—")}
        </span>
        <ChevronDown
          className={`size-2.5 shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="glass-float pop-in absolute bottom-full left-0 z-40 mb-1.5 max-h-64 w-56 overflow-y-auto rounded-xl p-1"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                onClick={() => {
                  setOpen(false);
                  if (!active) onChange(option.value);
                }}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover disabled:opacity-40 ${
                  option.danger ? "text-danger" : "text-ink"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px]">{option.label}</span>
                  {option.hint && (
                    <span className="mt-0.5 block truncate text-[10px] text-ink-3">
                      {option.hint}
                    </span>
                  )}
                </span>
                {active && <Check className="mt-0.5 size-3 shrink-0 text-accent" strokeWidth={2} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
