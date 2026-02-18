import type { AgentSession } from "@/lib/chat-types";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sessionToMarkdown, downloadMarkdown, slugifyFilename } from "@/lib/export-utils";

type ExportButtonProps = {
  session: AgentSession;
  threadTitle?: string;
};

export function ExportButton({ session, threadTitle }: ExportButtonProps) {
  const handleExport = () => {
    const markdown = sessionToMarkdown(session, threadTitle);
    const filename = slugifyFilename(session.title || threadTitle || "session");
    downloadMarkdown(markdown, filename);
  };

  return (
    <Button
      className="h-7"
      disabled={session.messages.length === 0}
      onClick={handleExport}
      size="sm"
      title="Exportar como Markdown"
      type="button"
      variant="outline"
    >
      <Download className="size-3.5" />
    </Button>
  );
}
