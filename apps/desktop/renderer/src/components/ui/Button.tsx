import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}

export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? "cf-button-primary"
      : variant === "ghost"
        ? "cf-invert-action inline-flex min-h-9 items-center justify-center gap-2 rounded-xl px-3 text-sm"
        : "cf-button-secondary";

  return (
    <button className={`${variantClass} ${className}`} {...props}>
      {children}
    </button>
  );
}