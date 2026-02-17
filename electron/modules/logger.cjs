function timestamp() {
  return new Date().toISOString();
}

function logError(context, error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${timestamp()}] ERROR [${context}] ${message}`);
}

function logWarn(context, message) {
  console.warn(`[${timestamp()}] WARN  [${context}] ${message}`);
}

function logInfo(context, message) {
  console.log(`[${timestamp()}] INFO  [${context}] ${message}`);
}

module.exports = {
  logError,
  logWarn,
  logInfo
};
