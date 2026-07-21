import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: ReactNode;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  action?: () => unknown | Promise<unknown>;
}

export default function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(6, Math.min(x, window.innerWidth - bounds.width - 6)),
      y: Math.max(6, Math.min(y, window.innerHeight - bounds.height - 6)),
    });
  }, [x, y, items]);

  useEffect(() => {
    const close = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const buttons = Array.from(
          menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
        );
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
      className="glass-float pop-in fixed z-[140] min-w-52 rounded-xl p-1.5"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item) =>
        item.separator ? (
          <div key={item.id} role="separator" className="my-1 border-t border-line" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              void item.action?.();
            }}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[11.5px] text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <span className="grid size-4 shrink-0 place-items-center text-ink-3">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut && <kbd className="ml-3 text-[9px]">{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
