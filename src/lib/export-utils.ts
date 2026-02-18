import type { AgentSession, Thread } from "@/lib/chat-types";

export function slugifyFilename(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60);
}

export function sessionToMarkdown(session: AgentSession, threadTitle?: string): string {
  const title = threadTitle ?? session.title;
  const date = new Date(session.updatedAt).toLocaleString();

  const lines: string[] = [`# ${title}`, "", `> Session: ${session.title} | Date: ${date}`, ""];

  for (const msg of session.messages) {
    const role = msg.role === "user" ? "User" : "Assistant";
    lines.push(`## ${role}`, "", msg.content, "");
  }

  lines.push("---", "*Exported from Claudex*");

  return lines.join("\n");
}

export function threadToMarkdown(thread: Thread): string {
  const date = new Date(thread.updatedAt).toLocaleString();

  const header = [
    `# ${thread.title}`,
    "",
    `> ${thread.sessions.length} session(s) | Last updated: ${date}`,
    ""
  ];

  const sessionBlocks = thread.sessions.map((s) => sessionToMarkdown(s, thread.title));

  return header.join("\n") + sessionBlocks.join("\n---\n");
}

export function downloadMarkdown(content: string, filename: string): void {
  const sanitized = slugifyFilename(filename) + ".md";
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = sanitized;
  a.click();
  URL.revokeObjectURL(url);
}
