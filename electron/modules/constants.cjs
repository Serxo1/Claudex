module.exports = {
  ANTHROPIC_API_URL: "https://api.anthropic.com/v1/messages",
  ANTHROPIC_API_VERSION: "2023-06-01",
  MAX_TOKENS_DEFAULT: 1600,
  CONTEXT_WINDOW_DEFAULT: 200000,
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  MAX_EDITOR_FILE_SIZE: 2 * 1024 * 1024,
  COMMAND_TIMEOUT_MS: 120000,
  PR_TIMEOUT_MS: 180000,
  CLI_TEST_TIMEOUT_MS: 4000,
  GIT_TIMEOUT_MS: 6000,
  SKIPPED_DIRS: [".git", "node_modules", ".DS_Store", "dist", "build", "out"],
  IMAGE_EXTENSIONS: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"],
  TEMP_PASTE_DIR: "claude-desktop-pastes"
};
