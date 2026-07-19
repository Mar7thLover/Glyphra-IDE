import type { ReactNode } from "react";

export function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] text-ink-2">{label}</span>
      {children}
      {hint ? <span className="text-[10px] leading-relaxed text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function SettingsSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-line bg-raised px-2 text-[11px] text-ink outline-none"
    >
      {children}
    </select>
  );
}

export function SettingsInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-8 rounded-md border border-line bg-raised px-2 text-[11px] text-ink outline-none placeholder:text-ink-3 ${props.className ?? ""}`}
    />
  );
}

export function ChoiceRow({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`h-7 rounded-md border px-2.5 text-[11px] transition-colors ${
              active
                ? "border-ink bg-ink text-[var(--bg-raised)]"
                : "border-line text-ink-2 hover:border-line-strong hover:text-ink"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-3 py-1 text-left"
    >
      <span>
        <span className="block text-[11px] text-ink-2">{label}</span>
        {hint ? <span className="mt-0.5 block text-[10px] text-ink-3">{hint}</span> : null}
      </span>
      <span
        className={`mt-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors ${
          checked ? "border-ink bg-ink" : "border-line bg-raised"
        }`}
      >
        <span
          className={`size-3 rounded-full bg-[var(--bg-raised)] transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}
