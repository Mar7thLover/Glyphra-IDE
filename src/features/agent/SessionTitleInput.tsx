import { useEffect, useRef, useState } from "react";

/**
 * Inline session rename. Enter commits, Escape and blur cancel — the same
 * contract as renaming a file in the tree.
 */
export default function SessionTitleInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    const next = value.trim();
    if (next && next !== initial) onCommit(next);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          committed.current = true;
          onCancel();
        }
      }}
      className="w-full rounded border border-line-strong bg-editor px-1 py-px text-[11px] text-ink outline-none"
    />
  );
}
