// ANSI colour helpers
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  blue:    "\x1b[34m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  magenta: "\x1b[35m",
  white:   "\x1b[37m",
  gray:    "\x1b[90m",
};

function timestamp() {
  return new Date().toISOString();
}

function hhmm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

function shortId(id) {
  return id ? id.slice(0, 8) : "?";
}

function truncate(str, max = 80) {
  if (!str) return "";
  const s = String(str).replace(/\n/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

// ── General logging ──────────────────────────────────────────────────────────

function logError(context, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${timestamp()}] ${C.red}ERROR${C.reset} [${context}] ${message}`);
}

function logWarn(context, message) {
  console.warn(`[${timestamp()}] ${C.yellow}WARN ${C.reset} [${context}] ${message}`);
}

function logInfo(context, message) {
  console.log(`[${timestamp()}] ${C.blue}INFO ${C.reset} [${context}] ${message}`);
}

// ── SDK session logging ───────────────────────────────────────────────────────

function sdkLine(prefix, ...parts) {
  console.log(`${C.gray}${hhmm()}${C.reset} ${C.bold}${C.cyan}SDK${C.reset} ${prefix} ${parts.join(" ")}`);
}

function logSDKStart(requestId, model, cwd, prompt) {
  const shortModel = (model || "default").replace("claude-", "").replace(/-\d{8}$/, "");
  const shortCwd   = cwd ? cwd.replace(process.env.HOME || "", "~") : "?";
  sdkLine(`${C.cyan}┌${C.reset}`, `${C.bold}${shortId(requestId)}${C.reset}`, `${C.dim}·${C.reset}`, `${C.magenta}${shortModel}${C.reset}`, `${C.dim}·${C.reset}`, `${C.dim}${shortCwd}${C.reset}`);
  if (prompt) {
    sdkLine(`${C.cyan}│${C.reset}`, `${C.dim}▶ "${truncate(prompt, 100)}"${C.reset}`);
  }
}

function logSDKTool(requestId, toolName, inputSummary, depth) {
  const isAgent  = toolName === "Task" || toolName === "TeamCreate";
  const indent   = depth > 0 ? `${C.dim}${"  ".repeat(depth)}└ ${C.reset}` : "";
  const icon     = isAgent ? `${C.magenta}⬡${C.reset}` : `${C.blue}⚙${C.reset}`;
  const name     = isAgent
    ? `${C.magenta}${C.bold}${toolName}${C.reset}`
    : `${C.blue}${toolName}${C.reset}`;
  const summary  = inputSummary ? `${C.dim}${truncate(inputSummary, 70)}${C.reset}` : "";
  sdkLine(`${C.cyan}│${C.reset}`, `${indent}${icon}`, name, summary);
}

function logSDKToolResult(requestId, toolName, isError, resultSummary, durationMs, depth) {
  const dur    = durationMs != null ? `${C.dim}(${durationMs}ms)${C.reset}` : "";
  const indent = depth > 0 ? `${C.dim}${"  ".repeat(depth)}  ${C.reset}` : "";
  const icon   = isError ? `${C.red}✗${C.reset}` : `${C.green}✓${C.reset}`;
  const res    = resultSummary ? `${C.dim}→ ${truncate(resultSummary, 60)}${C.reset}` : "";
  sdkLine(`${C.cyan}│${C.reset}`, `${indent}${icon}`, `${C.dim}${toolName}${C.reset}`, dur, res);
}

function logSDKSubagentStart(taskId, description) {
  sdkLine(`${C.cyan}│${C.reset}`, `${C.magenta}⬡ spawn${C.reset}`, `${C.bold}${truncate(description, 80)}${C.reset}`, `${C.dim}[${shortId(taskId)}]${C.reset}`);
}

function logSDKSubagentDone(taskId, status, summary) {
  const icon = status === "completed" ? `${C.green}⬡ done ${C.reset}` : `${C.red}⬡ ${status}${C.reset}`;
  const res  = summary ? `${C.dim}→ ${truncate(summary, 60)}${C.reset}` : "";
  sdkLine(`${C.cyan}│${C.reset}`, icon, `${C.dim}[${shortId(taskId)}]${C.reset}`, res);
}

function logSDKDone(requestId, durationMs, inputTokens, outputTokens, costUsd, isError) {
  const dur  = durationMs != null ? `${Math.round(durationMs / 1000)}s` : "?";
  const tok  = `${C.dim}in=${inputTokens ?? "?"} out=${outputTokens ?? "?"}${C.reset}`;
  const cost = costUsd != null ? `${C.dim}· $${costUsd.toFixed(4)}${C.reset}` : "";
  const icon = isError ? `${C.red}✗ ERROR${C.reset}` : `${C.green}✓ DONE ${C.reset}`;
  sdkLine(`${C.cyan}└${C.reset}`, icon, `${C.bold}${shortId(requestId)}${C.reset}`, `${C.dim}${dur}${C.reset}`, tok, cost);
}

function logSDKAborted(requestId) {
  sdkLine(`${C.cyan}└${C.reset}`, `${C.yellow}⊘ ABORT${C.reset}`, `${C.dim}${shortId(requestId)}${C.reset}`);
}

module.exports = {
  logError,
  logWarn,
  logInfo,
  logSDKStart,
  logSDKTool,
  logSDKToolResult,
  logSDKSubagentStart,
  logSDKSubagentDone,
  logSDKDone,
  logSDKAborted,
};
