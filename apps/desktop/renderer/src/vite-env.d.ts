/// <reference types="vite/client" />

interface Window {
  contextforge?: {
    selectProjectFolder: () => Promise<string | null>;
  };
}
