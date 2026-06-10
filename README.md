# PoE2 Market Dashboard

PoE2 latest normal league market scout for a small group. The MVP focuses on rare gear demand from `poe.ninja` build statistics.

## What It Does

- Detects the latest indexed normal PoE2 league.
- Excludes Standard, Hardcore, SSF, Ruthless, and private leagues.
- Generates a static `public/data/market.json` snapshot from `poe.ninja`.
- Ranks rare gear opportunities by usage, class fit, slot priority, and craft practicality.
- Keeps price automation out of MVP. The app provides trade-site links and copyable search text.

Rare slot demand and build usage are extracted from `poe.ninja`. Rare mod signatures and craft routes are rule-based recommendations, not direct item-mod exports.

## Local Use

```bash
npm install
npm run update:data
npm run dev
```

Windows local shortcut:

```text
start-local.cmd
```

The local URL is fixed to:

```text
http://127.0.0.1:4174
```

No-server local preview:

```bash
npm run build:standalone
```

Then open `standalone.html` directly in Chrome. This embeds the latest generated `market.json`, so the refresh button reloads the embedded snapshot rather than fetching live data.

## GitHub Pages

This folder is ready to use as a small GitHub Pages repository.

- `Deploy GitHub Pages` builds and deploys the Vite app.
- `Update poe.ninja Data` runs daily at `01:00 UTC` and also supports manual `workflow_dispatch`.
- The public app reads `public/data/market.json`.

For a private-feeling share, keep the repository or Pages URL known only to your group. GitHub Pages itself is still public unless the repository or plan supports restricted Pages.
