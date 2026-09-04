# dsh-model-params Agent Guide

## Scope and Purpose

- Independently published Host+Web Cordis bundle (0.1.x, DSH 0.1.2-rc.1+): a models.dev parameter assistant embedded in the official Models settings page.
- It only ever writes the `llm-pi-ai` namespace's `providers.<route>.models` array and only from an explicit client-side apply click. It never writes other namespaces, never touches credentials, never disables rows, and its Host route only fetches/caches https://models.dev/api.json.
- Mounts once in the Host composition. Never copy its row into an agent preset.

## Key Files

- `lib/modelsdev.js`: pure models.dev catalog parsing, id matching (exact → last-path-segment), effort intersection with pi-ai thinking levels.
- `lib/index.js`: Host `webServer` route `GET /api/model-params/lookup?ids=…` with origin/host fences, 6h in-memory cache, optional `HTTPS_PROXY` fallback via undici.
- `lib/client.js`: `__ModuleLoader__` bundle registering the `settings.models.provider-card` occupant keyed `llm-pi-ai`; preview panel + apply-this-provider write through the official Settings scope.
- `test/modelsdev.test.mjs`, `test/lifecycle-source.test.mjs`: pure matcher guards and structural guards.

## Invariants

- Client side must keep dotted remote injects (`'remote'`, `'remote.settings'`); dropping them fails the loader fiber exactly like the other plugins.
- Provider-card extension must stay keyed to the pi-ai settings namespace (`llm-pi-ai`) and defensively derive the route from `props.provider.entry ?? props.provider`.
- Writes go through the official scope: read snapshot, then one revision-aware op `{ path: ['providers', route, 'models'] }`. Default fill-missing; overwrite only when the user ticks the checkbox.
- Reasoning-effort keys written into `reasoningEfforts` must stay inside the pi-ai THINKING_LEVELS set (off/minimal/low/medium/high/xhigh/max) — keep `intersectLevels` in sync with `lib/modelsdev.js#THINKING_LEVELS`.
- Normal stacking only (z-index ≤ 30), styles lifecycle-owned, Escape/outside click cleanup, no body-level mounting, no extreme z-index.
- Host route: GET only, fenced (origin + loopback host), bounded query; no credentials; cache TTL bounded.

## Validation

From this package directory run:

```powershell
npm test
npm run check
npm pack --dry-run
```

After bundle or manifest changes refresh the workspace metadata generator (`node scripts/dsh-plugin-agents-metadata.mjs --write/--check` from the parent workspace). Verify on the real `http://127.0.0.1:3080` Models page after a user restart.

## Change Checklist

- models.dev shape or matching change: update `lib/modelsdev.js` and both test files together.
- Effort policy change: update both `THINKING_LEVELS`/`intersectLevels` copies and their guards.
- Provider-card owner-props change upstream: re-verify the defensive route derivation and the UI on the real Models page.

## Pitfalls

- models.dev `api.json` fields are best-effort: parse defensively, skip metadata-less records, never throw on unknown shapes (return `{ ok: false }` over the route).
- A provider card can appear multiple times (multiple profiles share `llm-pi-ai`); the component must read the route from each card's own props, never from a module-level variable.
- Client fetch is same-origin only; models.dev must never be fetched from the browser.
