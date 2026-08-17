import { build, context } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");

// `@deepseek-ai/dsh-llm` reads its own version at load time via
//   createRequire(import.meta.url)("../package.json")
// esbuild's CJS output replaces `import.meta` with an empty object, which
// crashed activation ("The argument 'filename' must be a file URL object…
// Received undefined"). Shim `import.meta.url` to the bundle's own file URL
// and drop a minimal package.json next to the bundle so the `../package.json`
// lookup resolves to `dist/package.json`.
const dshLlmPkg = JSON.parse(
  readFileSync("node_modules/@deepseek-ai/dsh-llm/package.json", "utf8"),
);
mkdirSync("dist", { recursive: true });
writeFileSync(
  "dist/package.json",
  JSON.stringify({ name: dshLlmPkg.name, version: dshLlmPkg.version }),
);

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension/extension.js",
  // `vscode` stays external, and so does `koffi`: it is a CJS native module
  // whose loader must resolve `@koromix/koffi-<platform>` from its real
  // install location. Bundling it broke that lookup (the native package is
  // not hoisted to the root node_modules), which crashed session-log
  // materialization on Windows with "Cannot read properties of undefined
  // (reading 'load')". The @deepseek-ai/* runtime deps are ESM-only
  // ("type": "module"); the extension host loads this bundle as CJS, so
  // leaving them external would fail activation with ERR_REQUIRE_ESM. They
  // must be bundled in.
  external: ["vscode", "koffi"],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: false,
  logLevel: "info",
  banner: {
    js: 'const __dshImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  define: {
    "import.meta.url": "__dshImportMetaUrl",
  },
};

if (watch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log("[esbuild] watching for changes…");
} else {
  await build(config);
}
