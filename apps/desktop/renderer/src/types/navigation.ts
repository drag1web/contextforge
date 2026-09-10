import type {
  ContextComposerFileReference,
  ContextComposerSnippet,
} from "./index";

export interface ContextComposerNavigationState {
  extraFiles: ContextComposerFileReference[];
  extraSnippets: ContextComposerSnippet[];
  isFileSearchOpen: boolean;
  fileSearchQuery: string;
  selectedPaths: string[];
  confirmedRecommendedPaths: string[];
  activeSnippetPath: string | null;
  isDetailsOpen: boolean;
}
