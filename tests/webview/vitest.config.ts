import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Webview smoke tests render the real React app under jsdom. The
// `@shared` alias mirrors src/ui/vite.config.ts so `src/ui/src/**`
// imports resolve exactly as they do in the shipped bundle. esbuild's
// automatic JSX runtime is enough here — no plugin-react (its preamble
// injection only works in a real Vite dev/build pipeline).
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../../src/shared"),
      // react/react-dom live in the @dsh/webview workspace package, not
      // the root; point at its node_modules (string keys match exactly
      // or as a path prefix, so "react-markdown" is unaffected).
      react: resolve(__dirname, "../../src/ui/node_modules/react"),
      "react-dom": resolve(__dirname, "../../src/ui/node_modules/react-dom"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/webview/**/*.test.{ts,tsx}"],
  },
});
