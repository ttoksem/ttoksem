import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const result = await build({
  entryPoints: ["dist/index.js"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22.5",
  write: false,
  // Inject a createRequire shim so CJS dependencies (e.g. commander) can
  // require node built-ins when the bundle runs as an ESM file.
  banner: {
    js: [
      'import { createRequire } from "node:module";',
      "const require = createRequire(import.meta.url);",
    ].join("\n"),
  },
  // node: builtins (incl. node:sqlite) stay external automatically on platform:node.
});

// esbuild preserves the entry's hashbang as line 1; replace it with our shebang
// that suppresses the node:sqlite experimental warning.
let text = result.outputFiles[0].text;
const shebang = "#!/usr/bin/env -S node --disable-warning=ExperimentalWarning";
if (text.startsWith("#!")) {
  text = shebang + "\n" + text.slice(text.indexOf("\n") + 1);
} else {
  text = shebang + "\n" + text;
}

writeFileSync("dist/cli.mjs", text);
console.log("bundled -> dist/cli.mjs");
