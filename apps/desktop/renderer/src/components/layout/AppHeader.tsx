import { FolderOpen } from "lucide-react";
import { Button } from "../ui/Button";

interface AppHeaderProps {
  title: string;
  eyebrow?: string;
  isLoading: boolean;
  onAddProject: () => void;
}

export function AppHeader({
  title,
  eyebrow = "Welcome back",
  isLoading,
  onAddProject
}: AppHeaderProps) {
  return (
    <header className="app-drag flex h-14 items-center justify-between border-b border-neutral-900 px-7">
      <div>
        <p className="text-[11px] text-neutral-500">{eyebrow}</p>
        <h2 className="text-base font-semibold tracking-tight text-white">{title}</h2>
      </div>

      <Button
        onClick={onAddProject}
        disabled={isLoading}
        variant="primary"
        className="app-no-drag min-h-9 px-4 text-sm"
      >
        <FolderOpen size={15} />
        {isLoading ? "Scanning..." : "Add project"}
      </Button>
    </header>
  );
}