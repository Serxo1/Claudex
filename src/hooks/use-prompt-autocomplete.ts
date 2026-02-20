import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { AppSettings } from "@/lib/chat-types";

export type FileMentionItem = {
  key: string;
  label: string;
  rootPath: string;
  relativePath: string;
  search: string;
};

export type UsePromptAutocompleteReturn = {
  slashMatch: RegExpMatchArray | null;
  slashQuery: string | null;
  filteredSlashCommands: string[];
  mentionMatch: RegExpMatchArray | null;
  mentionQuery: string | null;
  filteredMentionFiles: FileMentionItem[];
  isMentionMenuOpen: boolean;
  isSlashMenuOpen: boolean;
  mentionSelectedIndex: number;
  slashSelectedIndex: number;
  setMentionSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  setSlashSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
};

export function usePromptAutocomplete(
  input: string,
  slashCommands: string[],
  fileMentionIndex: FileMentionItem[],
  settings: AppSettings | null
): UsePromptAutocompleteReturn {
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const deferredInput = useDeferredValue(input);

  const slashMatch = useMemo(() => deferredInput.match(/^\/([^\s]*)$/), [deferredInput]);
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null;

  const filteredSlashCommands = useMemo(() => {
    if (slashQuery === null) return [];
    const query = slashQuery.trim();
    return slashCommands.filter((command) => command.toLowerCase().includes(query)).slice(0, 10);
  }, [slashCommands, slashQuery]);

  const mentionMatch = useMemo(() => deferredInput.match(/(?:^|\s)@([^\s]*)$/), [deferredInput]);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;

  const filteredMentionFiles = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.trim();
    if (!query) return fileMentionIndex.slice(0, 12);
    return fileMentionIndex.filter((item) => item.search.includes(query)).slice(0, 12);
  }, [fileMentionIndex, mentionQuery]);

  const isMentionMenuOpen = mentionQuery !== null && filteredMentionFiles.length > 0;
  const isSlashMenuOpen =
    settings?.authMode === "claude-cli" && slashQuery !== null && filteredSlashCommands.length > 0;

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    setMentionSelectedIndex(0);
  }, [mentionQuery]);

  return {
    slashMatch,
    slashQuery,
    filteredSlashCommands,
    mentionMatch,
    mentionQuery,
    filteredMentionFiles,
    isMentionMenuOpen,
    isSlashMenuOpen,
    mentionSelectedIndex,
    slashSelectedIndex,
    setMentionSelectedIndex,
    setSlashSelectedIndex
  };
}
