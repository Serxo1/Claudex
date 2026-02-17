// Context, types & hooks
export type {
  AttachmentsContext,
  TextInputContext,
  PromptInputControllerProps,
  ReferencedSourcesContext
} from "./context";
export {
  LocalReferencedSourcesContext,
  usePromptInputController,
  useProviderAttachments,
  usePromptInputAttachments,
  usePromptInputReferencedSources
} from "./context";

// Provider
export type { PromptInputProviderProps } from "./provider";
export { PromptInputProvider } from "./provider";

// Main component
export type { PromptInputMessage, PromptInputProps } from "./prompt-input";
export { PromptInput } from "./prompt-input";

// Textarea
export type { PromptInputTextareaProps } from "./textarea";
export { PromptInputTextarea } from "./textarea";

// Layout
export type {
  PromptInputBodyProps,
  PromptInputHeaderProps,
  PromptInputFooterProps,
  PromptInputToolsProps
} from "./layout";
export { PromptInputBody, PromptInputHeader, PromptInputFooter, PromptInputTools } from "./layout";

// Button & Submit
export type {
  PromptInputButtonTooltip,
  PromptInputButtonProps,
  PromptInputSubmitProps
} from "./button";
export { PromptInputButton, PromptInputSubmit } from "./button";

// Action Menu
export type {
  PromptInputActionAddAttachmentsProps,
  PromptInputActionMenuProps,
  PromptInputActionMenuTriggerProps,
  PromptInputActionMenuContentProps,
  PromptInputActionMenuItemProps
} from "./action-menu";
export {
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem
} from "./action-menu";

// Select
export type {
  PromptInputSelectProps,
  PromptInputSelectTriggerProps,
  PromptInputSelectContentProps,
  PromptInputSelectItemProps,
  PromptInputSelectValueProps
} from "./select";
export {
  PromptInputSelect,
  PromptInputSelectTrigger,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectValue
} from "./select";

// HoverCard
export type {
  PromptInputHoverCardProps,
  PromptInputHoverCardTriggerProps,
  PromptInputHoverCardContentProps
} from "./hover-card";
export {
  PromptInputHoverCard,
  PromptInputHoverCardTrigger,
  PromptInputHoverCardContent
} from "./hover-card";

// Tabs
export type {
  PromptInputTabsListProps,
  PromptInputTabProps,
  PromptInputTabLabelProps,
  PromptInputTabBodyProps,
  PromptInputTabItemProps
} from "./tabs";
export {
  PromptInputTabsList,
  PromptInputTab,
  PromptInputTabLabel,
  PromptInputTabBody,
  PromptInputTabItem
} from "./tabs";

// Command
export type {
  PromptInputCommandProps,
  PromptInputCommandInputProps,
  PromptInputCommandListProps,
  PromptInputCommandEmptyProps,
  PromptInputCommandGroupProps,
  PromptInputCommandItemProps,
  PromptInputCommandSeparatorProps
} from "./command";
export {
  PromptInputCommand,
  PromptInputCommandInput,
  PromptInputCommandList,
  PromptInputCommandEmpty,
  PromptInputCommandGroup,
  PromptInputCommandItem,
  PromptInputCommandSeparator
} from "./command";
