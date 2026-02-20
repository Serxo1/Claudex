// ---------------------------------------------------------------------------
// chat-cli-legacy.cjs — Legacy sync CLI (used by chat:send non-streaming)
// ---------------------------------------------------------------------------

const { spawn } = require("node:child_process");

const { collectContextDirs } = require("./workspace.cjs");
const { getLatestUserPrompt, shouldApplyEffort } = require("./chat-utils.cjs");

function buildCliPrompt(messages) {
  const turns = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const label = message.role === "user" ? "User" : "Assistant";
      return `${label}: ${message.content}`;
    });
  return `${turns.join("\n\n")}\n\nAssistant:`;
}

function resolveClaudeCliPrompt(messages) {
  const latestPrompt = getLatestUserPrompt(messages);
  return latestPrompt || buildCliPrompt(messages);
}

function parseClaudeOutput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const candidates = [trimmed, ...lines.slice().reverse()];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed.result === "string" && parsed.result.trim()) return parsed.result.trim();
      if (typeof parsed.output === "string" && parsed.output.trim()) return parsed.output.trim();
      if (Array.isArray(parsed.content)) {
        const joined = parsed.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n").trim();
        if (joined) return joined;
      }
    } catch { continue; }
  }
  return trimmed;
}

function parseClaudeErrorSummary(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const parsed = parseClaudeOutput(raw);
  if (parsed && parsed !== raw.trim()) return parsed;
  const resultMatch = raw.match(/"result"\s*:\s*"([^"]+)"/);
  if (resultMatch?.[1]) return resultMatch[1];
  const textMatch = raw.match(/"text"\s*:\s*"([^"]+)"/);
  if (textMatch?.[1]) return textMatch[1];
  return "";
}

function buildClaudeCliErrorDetail(stdout, stderr, code) {
  const joined = `${stdout || ""}\n${stderr || ""}`;
  if (/Prompt is too long/i.test(joined)) return "Prompt is too long";

  const fromStdout = parseClaudeErrorSummary(stdout);
  if (fromStdout) return fromStdout;

  const fromStderr = parseClaudeErrorSummary(stderr);
  if (fromStderr) return fromStderr;

  const compactStderr = (stderr || "").replace(/\s+/g, " ").trim();
  if (compactStderr) return compactStderr.length > 320 ? `${compactStderr.slice(0, 317)}...` : compactStderr;

  const compactStdout = (stdout || "").replace(/\s+/g, " ").trim();
  if (compactStdout) return compactStdout.length > 320 ? `${compactStdout.slice(0, 317)}...` : compactStdout;

  return `exit code ${code}`;
}

function parseClaudeResult(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { content: "", sessionId: "" };

  let sessionId = "";
  let content = "";

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const candidates = [trimmed, ...lines.slice().reverse()];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed.session_id === "string" && parsed.session_id) sessionId = parsed.session_id;
      if (typeof parsed.result === "string" && parsed.result.trim()) {
        content = parsed.result.trim();
      } else if (typeof parsed.output === "string" && parsed.output.trim()) {
        content = parsed.output.trim();
      } else if (Array.isArray(parsed.content)) {
        const joined = parsed.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n").trim();
        if (joined) content = joined;
      }
      if (content && sessionId) break;
    } catch { continue; }
  }

  return { content: content || parseClaudeOutput(raw), sessionId };
}

function runClaudeCli(messages, model, resumeSessionId, effort, contextFiles = [], forcedSessionId = "", workspaceDirs = []) {
  const prompt = resolveClaudeCliPrompt(messages);

  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--output-format", "json"];
    if (typeof model === "string" && model.trim()) args.push("--model", model.trim());
    if (shouldApplyEffort(model, effort)) args.push("--effort", effort.trim());
    if (typeof resumeSessionId === "string" && resumeSessionId.trim()) args.push("--resume", resumeSessionId.trim());
    if (typeof forcedSessionId === "string" && forcedSessionId.trim()) args.push("--session-id", forcedSessionId.trim());

    const contextDirs = collectContextDirs(contextFiles);
    const addDirs = [...new Set([...workspaceDirs, ...contextDirs])];
    for (const dir of addDirs) args.push("--add-dir", dir);

    const { CLAUDECODE: _cc2, ...safeEnv2 } = process.env;
    const child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"], env: safeEnv2 });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      reject(new Error(`Unable to execute Claude CLI: ${error.message}. Install CLI and run "claude login".`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Claude CLI failed: ${buildClaudeCliErrorDetail(stdout, stderr, code)}`));
        return;
      }
      resolve(parseClaudeResult(stdout));
    });
  });
}

module.exports = {
  buildCliPrompt,
  resolveClaudeCliPrompt,
  parseClaudeOutput,
  parseClaudeErrorSummary,
  buildClaudeCliErrorDetail,
  parseClaudeResult,
  runClaudeCli
};
