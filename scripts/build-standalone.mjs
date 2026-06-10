import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

function matchAsset(html, pattern, label) {
  const match = html.match(pattern);
  if (!match) throw new Error(`Could not find ${label} in dist/index.html`);
  return match[1].replace(/^\.\//, "");
}

const indexHtml = await readFile(path.join(DIST, "index.html"), "utf8");
const cssPath = matchAsset(indexHtml, /href="\.\/([^"]+\.css)"/, "CSS asset");
const jsPath = matchAsset(indexHtml, /src="\.\/([^"]+\.js)"/, "JS asset");

const [css, js, marketJson] = await Promise.all([
  readFile(path.join(DIST, cssPath), "utf8"),
  readFile(path.join(DIST, jsPath), "utf8"),
  readFile(path.join(DIST, "data", "market.json"), "utf8"),
]);

const safeJson = marketJson.replace(/</g, "\\u003c");

const standalone = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PoE2 Market Dashboard</title>
    <style>
${css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
window.__MARKET_DATA__ = ${safeJson};
    </script>
    <script type="module">
${js}
    </script>
  </body>
</html>
`;

await writeFile(path.join(ROOT, "standalone.html"), standalone, "utf8");
console.log(`Wrote ${path.join(ROOT, "standalone.html")}`);
