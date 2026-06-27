/// <reference types="vite/client" />

interface Window {
  contextforge?: {
    selectProjectFolder: () => Promise<string | null>;
    windowControls?: {
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      isMaximized: () => Promise<boolean>;
    };
  };
}