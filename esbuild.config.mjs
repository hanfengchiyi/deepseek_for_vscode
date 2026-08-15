import { build, context } from "esbuild";
import { readFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension/extension.js",
  external: ["vscode", ...Object.keys(pkg.dependencies ?? {})],
  format: "cjs",
  platform: "node",
  target: "node20",
  sourcemap: true,
  minify: false,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log("[esbuild] watching for changes…");
} else {
  await build(config);
}
