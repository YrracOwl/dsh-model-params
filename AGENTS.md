# dsh-model-params Agent Guide

## Scope and Purpose

- Independently published Host+Web Cordis bundle (0.1.x, DSH 0.1.2-rc.1+): a models.dev parameter assistant embedded in the official Models settings page.
- It only ever writes the `llm-pi-ai` namespace's `providers.<route>.models` array and only from an explicit client-side apply click. It never writes other namespaces, never touches credentials, never disables rows, and its Host route only fetches/caches https://models.dev/api.json.
- Mounts once in the Host composition. Never copy its row into an agent preset.

## Key Files

- `lib/modelsdev.js`: pure models.dev catalog parsing, id matching (**provider route → id vendor prefix → unmatched**), effort intersection with pi-ai thinking levels.
- `lib/index.js`: Host `webServer` route `GET /api/model-params/lookup?ids=…&route=…` with origin/host fences, 6h in-memory cache, optional `HTTPS_PROXY` fallback via undici.
- `lib/client.js`: `__ModuleLoader__` bundle registering the `settings.models.provider-card` occupant keyed `llm-pi-ai`; preview panel + apply-this-provider write through the official Settings scope.
- `test/modelsdev.test.mjs`, `test/lifecycle-source.test.mjs`, `test/route-match.test.mjs`, `test/efforts.test.mjs`: matcher guards, structural guards, route-preference guards, and behavioural reasoning-effort guards.
- `test/efforts.test.mjs`: BEHAVIOURAL guards for the reasoning-effort rules. A client bundle cannot `require('./x.js')` (its `require` resolves platform seeds only), so this suite extracts the `// #region reasoning-efforts` block from `lib/client.js` and runs it in a VM. Assert on behaviour, not source text: a source-text test passes for an implementation that merely mentions the right words.

## Invariants

- Client side must keep dotted remote injects (`'remote'`, `'remote.settings'`); dropping them fails the loader fiber exactly like the other plugins.
- Provider-card extension must stay keyed to the pi-ai settings namespace (`llm-pi-ai`) and defensively derive the route from `props.provider.entry ?? props.provider`.
- The same card is ALSO registered on the root-scope list seat `settings.section` (id `yotk-model-params`, order `63`, label thunk `() => 'YOTK · Model Params'`), which makes it a first-class page one click deep in 设置 on hosts that declare that seat. It is additive and host-version dependent: keep it BESIDE the provider-card extension (this package has no `plugins.row.config` row occupant, so `ModelParamsExtension` IS its card component), register it through the same non-gating `ctx.inject(['slots'], …)` shape whose callback returns the registration disposer, and render that SAME component — one settings UI, one transport, one persistence path; a host that does not declare the seat simply never fires it, so the page adds no activation gate.
- The provider-card seat supplies `props.provider`; the `settings.section` seat's owner share is `{ close }` ALONE (`SettingsSectionOwnerProps` in `@deepseek-ai/dsh-client-ui-settings`), so that page is handed NO provider and resolves its own from the ONE scope it already reads — the `llm-pi-ai` section, whose `providers` dict IS keyed by provider route (`PiAiProviderProfile`) — addressing the first declared route or the one the user picked. Render the chooser only when the namespace declares more than one route, always from real configured routes: never synthesize a route, never add a second read/write path, never key the page off a module-level provider. It must never render blank — a loading, unavailable or provider-less namespace renders an explicit hint. A lookup answer is stamped with the route it was requested for (`rawResult.route === route`), because the page can change its addressed provider while a request is in flight and another provider's matches must not be previewed. `test/lifecycle-source.test.mjs` pins the seat identity, the standalone render, the hints, the chooser and the route stamp.
- Writes go through the official scope: read snapshot, then one revision-aware op `{ path: ['providers', route, 'models'] }`. Default fill-missing; overwrite only when the user ticks the checkbox.
- Reasoning efforts are written in the shape the HOST validates, not an approximation. Two authorities define it: `resolveModelReasoning` in `@deepseek-ai/dsh-llm-pi-ai` and `ModelReasoningEfforts` in `@deepseek-ai/dsh-client-ui-settings-models` (the per-model editor DSH 0.2.1 added to the Models page). The rules:
  - the KEY is a pi-ai thinking level;
  - the VALUE is the **wire string actually sent** for that level, or `null`. It is NOT the level name in general — a gateway may map `low` onto the wire value `"medium"`, and that is a legitimate, hand-tuned route;
  - only `off` may be `null`; every other level needs a non-empty string;
  - `{}` is refused, and so is a map with no level beyond `off`.

  The Host applies these to the WHOLE route, so an invalid map breaks every model on that provider, not just the one being edited. `mergeEfforts` therefore declines to write rather than emit one. **Never regress to `value = level`** (the pre-0.1.7 behaviour): it silently mismapped every gateway whose wire vocabulary differs, and it wrote the string `'off'` where the Host requires `null`. `test/efforts.test.mjs` extracts the marked `reasoning-efforts` region from `lib/client.js` and runs it, asserting these rules against the official contract.
- The level space is read from the **host's own schema**, the same way the official page does it (`hostReasoningLevels`: `ctx.settingsSchema` + `rehydrate(namespace.schema)` + `nodeAtPath(['providers', '\u0000probe', 'models', '0', 'reasoningEfforts'])` + the union member's `sKey` list). `THINKING_LEVELS` is only the FALLBACK for a host that cannot answer; do not treat it as the source of truth. The probe route name is `\u0000probe` deliberately — it cannot collide with a real provider. A ConfigForm snapshot carries no schema (only the describe VIEW does), which is why the resolver lives in `apply` and is passed to both seats as `props.resolveLevels`.
- `reasoningEfforts: false` is a deliberate "this model does not reason" statement; never widen it from the catalog. A legal wire value already on a model survives a fill; only `覆盖已有值` may replace what the Host cannot accept, and only `覆盖已有值` prunes a level the catalog dropped.
- Normal stacking only (z-index ≤ 30), styles lifecycle-owned, Escape/outside click cleanup, no body-level mounting, no extreme z-index.
- Host route: GET only, fenced (origin + loopback host), bounded query; no credentials; cache TTL bounded.

## Validation

From this package directory run:

```powershell
npm test
npm run check
npm pack --dry-run
```

After bundle or manifest changes refresh the workspace metadata generator (`node scripts/dsh-plugin-agents-metadata.mjs --write/--check` from the parent workspace). Verify on the real `http://127.0.0.1:3080` after a user restart: the Models-page provider card AND, where the host declares the seat, **设置 → YOTK · Model Params** as a page one click deep (its provider resolution has no render evidence from tests).

## Change Checklist

- models.dev shape or matching change: update `lib/modelsdev.js` and both test files together.
- **A model id alone does not identify catalog facts.** models.dev lists one id under dozens of providers with different limits (measured 2026-10-17: `deepseek/deepseek-v4.1-flash` is 1000000/384000 at CommandCode, 1048576/65536 at SenseNova, 131072/8192 at NEAR). The lookup is therefore keyed by the **provider route being edited**, and `lookupModels` resolves in this order: route's own catalog provider (case-insensitive) → id vendor prefix → unmatched. It must NOT fall back to "the first record with metadata": a wrong context window silently breaks every request on that route, which is worse than reporting 未收录. The client sends `&route=` and stamps the answer with it; `test/route-match.test.mjs` pins all of this.
- Effort policy change: update both `THINKING_LEVELS`/`intersectLevels` copies and their guards.
- Provider-card owner-props change upstream: re-verify the defensive route derivation and the UI on the real Models page.
- Section-seat owner-props change upstream (`SettingsSectionOwnerProps`): re-verify that the page still resolves a real provider on its own, still offers a chooser only among real routes, and still explains an empty/unavailable namespace.
- Install-surface change: `README.md` is the only user-facing install surface, so keep its recommended `dsh plugin --profile web add dsh-model-params` command and the required DSH Web restart current.

## Pitfalls

- models.dev `api.json` fields are best-effort: parse defensively, skip metadata-less records, never throw on unknown shapes (return `{ ok: false }` over the route).
- A provider card can appear multiple times (multiple profiles share `llm-pi-ai`); the component must read the route from each card's own props, never from a module-level variable.
- Client fetch is same-origin only; models.dev must never be fetched from the browser.
