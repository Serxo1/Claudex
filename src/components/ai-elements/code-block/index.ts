// Highlighter utilities
export type { TokenizedCode } from "./highlighter";
export { highlightCode } from "./highlighter";

// Main components
export { CodeBlock, CodeBlockContent } from "./code-block";

// UI components
export {
  CodeBlockBody,
  CodeBlockContainer,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockFilename,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockLanguageSelector,
  CodeBlockLanguageSelectorTrigger,
  CodeBlockLanguageSelectorValue,
  CodeBlockLanguageSelectorContent,
  CodeBlockLanguageSelectorItem
} from "./components";

export type {
  CodeBlockCopyButtonProps,
  CodeBlockLanguageSelectorProps,
  CodeBlockLanguageSelectorTriggerProps,
  CodeBlockLanguageSelectorValueProps,
  CodeBlockLanguageSelectorContentProps,
  CodeBlockLanguageSelectorItemProps
} from "./components";
