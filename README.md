# PoE2 Market Dashboard

PoE2 latest normal league market scout for a small group. The MVP focuses on rare gear demand from `poe.ninja` build statistics.

Canonical app:

https://dust41337.github.io/poe2-market-dashboard/

## What It Does

- Detects the latest indexed normal PoE2 league.
- Excludes Standard, Hardcore, SSF, Ruthless, and private leagues.
- Generates a static `public/data/market.json` snapshot from `poe.ninja`.
- Ranks rare gear opportunities by usage, class fit, slot priority, and craft practicality.
- Keeps price automation out of MVP. The app provides trade-site links and copyable search text.

Rare slot demand and build usage are extracted from `poe.ninja`. Rare mod signatures and craft routes are rule-based recommendations, not direct item-mod exports.

## GitHub Pages

The dashboard is meant to be used from GitHub Pages, not from a local file path.

- `Deploy GitHub Pages` builds and deploys the Vite app on every push to `main`.
- `Update poe.ninja Data` runs daily at `01:00 UTC` and supports manual `workflow_dispatch`.
- The app reads `public/data/market.json` as the single checked-in snapshot.
- The in-app `Actions更新` button opens the manual update workflow.
- The in-app `JSON再読込` button only reloads the already-deployed static JSON.

For a private-feeling share, keep the repository or Pages URL known only to your group. GitHub Pages itself is still public unless the repository or plan supports restricted Pages.

## Trade Links

Official PoE Trade filtered URLs require creating a search id through the official trade API. That endpoint is rate-limited, so the data update only creates filtered URLs for the highest-priority rare candidates by default.

- `Filtered` opens a generated official Trade URL with rarity, category, and stat filters.
- `Manual` opens the league Trade page; use the detail pane's filters as the manual checklist.
- Set `TRADE_LINK_LIMIT` during data update to change how many filtered URLs are generated.

## Data Update

Manual update path:

1. Open `Actions更新` from the app, or open the `Update poe.ninja Data` workflow in GitHub.
2. Run the workflow on `main`.
3. Wait for the snapshot commit and the following Pages deploy.
4. Use `JSON再読込` in the app after deploy completes.

## Local Development

Local development still uses the Vite dev server. Direct `file://` preview is intentionally not supported.

```bash
npm install
npm run update:data
npm run dev
```

Windows local shortcut:

```text
start-local.cmd
```

The development URL is fixed to `http://127.0.0.1:4174`.
