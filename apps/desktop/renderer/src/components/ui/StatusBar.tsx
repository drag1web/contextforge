interface StatusBarProps {
  message: string;
}

export function StatusBar({ message }: StatusBarProps) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-neutral-950/50 px-4 py-3 text-sm text-neutral-400">
      {message}
    </div>
  );
}