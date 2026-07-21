import { Check, ChevronDown, type LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface PillOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
}

const MENU_WIDTH = 224;
const MENU_MAX_HEIGHT = 256;
const VIEWPORT_GAP = 8;
const ANCHOR_GAP = 6;

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  opensUp: boolean;
}

export function placePillMenu(
  anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): MenuPosition {
  const width = Math.min(MENU_WIDTH, Math.max(0, viewportWidth - VIEWPORT_GAP * 2));
  const left = Math.min(
    Math.max(anchor.left, VIEWPORT_GAP),
    Math.max(VIEWPORT_GAP, viewportWidth - VIEWPORT_GAP - width),
  );
  const availableAbove = Math.max(0, anchor.top - ANCHOR_GAP - VIEWPORT_GAP);
  const availableBelow = Math.max(
    0,
    viewportHeight - anchor.bottom - ANCHOR_GAP - VIEWPORT_GAP,
  );
  const desiredHeight = Math.min(contentHeight, MENU_MAX_HEIGHT);
  const opensUp = availableAbove >= desiredHeight || availableAbove >= availableBelow;
  const maxHeight = Math.min(
    MENU_MAX_HEIGHT,
    opensUp ? availableAbove : availableBelow,
  );
  const renderedHeight = Math.min(contentHeight, maxHeight);
  const top = opensUp
    ? Math.max(VIEWPORT_GAP, anchor.top - ANCHOR_GAP - renderedHeight)
    : anchor.bottom + ANCHOR_GAP;

  return { left, top, width, maxHeight, opensUp };
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
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  const updateMenuPosition = useCallback(() => {
    if (!rootRef.current || !menuRef.current) return;
    setMenuPosition(
      placePillMenu(
        rootRef.current.getBoundingClientRect(),
        menuRef.current.scrollHeight,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPosition(null);
      return;
    }
    updateMenuPosition();
  }, [open, options.length, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const menuStyle: CSSProperties | undefined = menuPosition
    ? {
        left: menuPosition.left,
        top: menuPosition.top,
        width: menuPosition.width,
        maxHeight: menuPosition.maxHeight,
        transformOrigin: menuPosition.opensUp ? "bottom" : "top",
      }
    : undefined;

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

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={menuStyle}
            className={`glass-float pop-in fixed z-[100] max-h-64 w-56 overflow-y-auto rounded-xl p-1 ${
              menuPosition ? "visible" : "invisible"
            }`}
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
                      <span className="mt-0.5 block text-[10px] leading-snug text-ink-3">
                        {option.hint}
                      </span>
                    )}
                  </span>
                  {active && (
                    <Check className="mt-0.5 size-3 shrink-0 text-accent" strokeWidth={2} />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
