/// <reference types="vite/client" />

interface Window {
  contextforge?: {
    selectProjectFolder: () => Promise<string | null>;
    openExternalUrl?: (url: string) => Promise<boolean>;
    windowControls?: {
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
    };
  };
}