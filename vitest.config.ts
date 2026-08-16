import { defineConfig } from "vitest/config";

// Unit tests (tests/unit) run under the default node environment.
// tests/webview has its own config (tests/webview/vitest.config.ts —
// jsdom + react aliases) and is run via `pnpm test:webview`.
export default defineConfig({
  test: {
    exclude: ["tests/webview/**", "**/node_modules/**", "**/dist/**"],
  },
});
