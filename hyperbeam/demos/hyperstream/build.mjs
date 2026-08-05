import { build } from "esbuild";

await build({
  entryPoints: ["hybrid-player.js"],
  bundle: true,
  format: "esm",
  legalComments: "inline",
  minify: true,
  outfile: "dist/hybrid-player.js",
  platform: "browser",
  target: ["chrome110", "edge110", "firefox115", "safari17"],
});
