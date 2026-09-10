interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

export function Switch({
  checked,
  disabled = false,
  label,
  onCheckedChange,
  className = "",
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-state={checked ? "checked" : "unchecked"}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={[
        "relative h-6 w-11 shrink-0 overflow-hidden rounded-full border outline-none",
        "transition-[background-color,border-color,box-shadow] duration-150 ease-out",
        "focus-visible:border-white/60 focus-visible:ring-4 focus-visible:ring-white/10",
        "motion-reduce:transition-none",
        checked
          ? "border-neutral-300/70 bg-neutral-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]"
          : "border-neutral-800 bg-neutral-950 hover:border-neutral-700",
        disabled
          ? "cursor-not-allowed opacity-45"
          : "cursor-pointer active:scale-[0.98] motion-reduce:active:scale-100",
        className,
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "absolute left-[3px] top-[3px] h-4 w-4 rounded-full",
          "transition-[transform,background-color] duration-150 ease-out motion-reduce:transition-none",
          "shadow-[0_1px_3px_rgba(0,0,0,0.35)]",
          checked
            ? "translate-x-[20px] bg-neutral-950 ring-1 ring-black/80"
            : "translate-x-0 bg-neutral-500 ring-1 ring-white/5",
        ].join(" ")}
      />
    </button>
  );
}
