import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function IconButton({ children, className = "", ...props }: IconButtonProps) {
  return (
    <button
      className={[
        "inline-flex size-8 items-center justify-center rounded-lg border border-neutral-900",
        "bg-neutral-950 text-neutral-500 transition hover:border-neutral-700 hover:text-white",
        className
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}