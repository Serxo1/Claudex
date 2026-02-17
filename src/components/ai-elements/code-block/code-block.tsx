"use client";

import type { HTMLAttributes } from "react";
import type { BundledLanguage } from "shiki";

import { createContext, useEffect, useMemo, useState } from "react";

import type { TokenizedCode } from "./highlighter";
import { createRawTokens, highlightCode } from "./highlighter";
import { CodeBlockBody, CodeBlockContainer } from "./components";

// Types
type CodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  language: BundledLanguage;
  showLineNumbers?: boolean;
};

interface CodeBlockContextType {
  code: string;
}

// Context - exported for use by CodeBlockCopyButton
export const CodeBlockContext = createContext<CodeBlockContextType>({
  code: ""
});

export const CodeBlockContent = ({
  code,
  language,
  showLineNumbers = false
}: {
  code: string;
  language: BundledLanguage;
  showLineNumbers?: boolean;
}) => {
  // Memoized raw tokens for immediate display
  const rawTokens = useMemo(() => createRawTokens(code), [code]);

  // Try to get cached result synchronously, otherwise use raw tokens
  const [tokenized, setTokenized] = useState<TokenizedCode>(
    () => highlightCode(code, language) ?? rawTokens
  );

  useEffect(() => {
    let cancelled = false;

    // Reset to raw tokens when code changes (shows current code, not stale tokens)
    setTokenized(highlightCode(code, language) ?? rawTokens);

    // Subscribe to async highlighting result
    highlightCode(code, language, (result) => {
      if (!cancelled) {
        setTokenized(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [code, language, rawTokens]);

  return (
    <div className="relative overflow-auto">
      <CodeBlockBody showLineNumbers={showLineNumbers} tokenized={tokenized} />
    </div>
  );
};

export const CodeBlock = ({
  code,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}: CodeBlockProps) => {
  const contextValue = useMemo(() => ({ code }), [code]);

  return (
    <CodeBlockContext.Provider value={contextValue}>
      <CodeBlockContainer className={className} language={language} {...props}>
        {children}
        <CodeBlockContent code={code} language={language} showLineNumbers={showLineNumbers} />
      </CodeBlockContainer>
    </CodeBlockContext.Provider>
  );
};
