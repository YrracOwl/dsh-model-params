# dsh-model-params

## English

**Current release: 0.1.12** — On the 0.2.1 line:

1. **Reasoning efforts follow the official declaration shape.** Keys are pi-ai thinking levels, values are the *wire* strings actually sent (with `off` as `null`), and the level list is read from the host's own schema the way the official Models page reads it. Previous releases wrote `value = level` and the string `'off'`, which silently mismapped any gateway whose wire vocabulary differs from pi-ai's.
2. **Lookups identify the catalog record by the provider's endpoint (`baseURL`) first.** models.dev publishes each provider's `api` URL, and that endpoint is what a deployment actually is: a route pointing at `api.commandcode.ai` resolves to the catalog's `commandcode` record whatever the route is named, and two account names on one gateway (such as `commandcode` and `goat-163`) correctly share one record. When the endpoint is unknown, the route name and then the model id's vendor prefix decide.
3. **When nothing identifies the deployment, the official parameters are still offered by model name.** A route whose endpoint the catalog does not know (our `open-design-go`) used to dead-end at 未收录 even though the catalog lists that model under other providers. The lookup now returns those records as a **candidate menu**: the panel lists them, a human picks the one this route actually points at, and only then are the numbers previewed and written. A menu is a question, never an automatic answer — no candidate is applied without a click.
4. **A model id alone does not identify catalog facts.** One id is listed by dozens of providers with different limits (measured: CommandCode 1000000/384000, SenseNova 1048576/65536, NEAR 131072/8192), which is why a candidate menu needs a human choice rather than a heuristic pick.

For every configured `llm-pi-ai` provider card (custom OpenAI-compatible gateways such as the ones you add under Settings → Models), a `models.dev 参数` control fetches the official models.dev records for the provider's configured model ids and proposes the metadata pi-ai needs: context window, max output tokens, and reasoning-effort levels. One click writes the merged `models` array back to that provider profile through the official revision-aware Settings API.

### Reasoning efforts follow the official declaration shape

DSH 0.2.1 added a per-model reasoning-effort editor to the official Models page (`ModelReasoningEfforts` in `dsh-client-ui-settings-models`); the Host validates the same field in `dsh-llm-pi-ai`. This plugin writes that exact shape rather than an approximation of it:

```jsonc
"reasoningEfforts": { "off": null, "low": "low", "high": "high" }
```

- The **key** is a pi-ai thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`).
- The **value** is the *wire* string actually sent for that level. It is **not** the level name in general: a gateway may map `low` onto the wire value `"medium"`, and the panel shows that as `low=medium` instead of hiding it behind the key.
- Only `off` may be `null` (it sends nothing); every other level needs a non-empty string.
- The level list is read from the **host's own schema** (`ctx.settingsSchema` + the `llm-pi-ai` namespace view) with the same walk the official page performs. A host that cannot answer falls back to the same fixed list.
- The plugin refuses to emit a map the Host would reject: `{}`, `off` alone, or a non-`off` level with an empty value fails the **whole route**, so it declines to write rather than break a provider.
- A level your gateway already declares is preserved verbatim unless you tick **覆盖已有值**; `reasoningEfforts: false` (a deliberately non-reasoning model) is never widened.

On hosts that declare the root-scope `settings.section` list seat, that same card is also registered as a first-class settings page — identity `YOTK · Model Params`, id `yotk-model-params`, order `63` — additive beside the Models-page extension and never an activation gate. The page needs nothing selected elsewhere: it reads the `llm-pi-ai` providers you have configured through the same settings scope, addresses the first one (with a picker whenever several exist), and states plainly when the namespace is loading, unserved, or has no provider yet.

Safety boundaries:

- The control never auto-writes. You open the panel, review the per-model diff, then click **应用并写入该 provider** — it writes only that provider's `models` array in the `llm-pi-ai` namespace.
- Default policy fills **missing** parameters only; tick **覆盖已有值** to also replace differing ones.
- At the top of the panel, optionally enable one shared models.dev request proxy and edit its URL. The setting is shared by every provider card, applies to the next lookup, and does not change any LLM provider `baseURL`.
- Nothing leaves the machine except the models.dev catalog request (Host side, optional shared proxy or `HTTPS_PROXY` fallback), and no credentials are ever sent.
- Models whose id the catalog lists under other providers get a **candidate menu** (see below) instead of a dead end; an id no provider lists at all is reported as 未收录 and left untouched.

models.dev model ids are **not unique**: the same `deepseek/deepseek-v4.1-flash` is listed by dozens of providers with different limits. The matcher resolves the record by the route's **endpoint** first (a route pointing at `api.commandcode.ai` takes the catalog's `commandcode` record, and two account names on that gateway share it), then by the route name, then by the model id's vendor prefix.

When none of those identifies a deployment, the plugin does **not** attach an arbitrary record — but it no longer stops at 未收录 either. It offers the records that list that model NAME as a candidate menu (`candidates` in the lookup response), collapsed to a few with a **展开其余 N 个** affordance, each labelled with its own context/max-output numbers. Picking one marks it **已选**, previews exactly what would be written, and includes it in the write; nothing is chosen for you. A menu never appears when the endpoint or route name has already identified the deployment — there, a model the deployment does not serve is a genuine miss, and another vendor's numbers would be systematically wrong.

## 中文

面向 DeepSeek Harness Web 官方 **设置 → 模型** 页的 models.dev 参数助手。每个已配置的 `llm-pi-ai` provider 卡片内提供 `models.dev 参数` 入口：按该 provider 的模型 id 在 models.dev 官方目录中匹配，预览上下文窗口 / max 输出 / 推理档位，确认后一次性写回该 provider 的 `models` 配置（官方 revision-aware Settings API，仅写 `llm-pi-ai` 命名空间下当前 provider 的数组）。

在声明根级 `settings.section` 列表座的宿主上，同一张卡片还会注册为设置页的一级入口 —— 标识 `YOTK · Model Params`、id `yotk-model-params`、order `63` —— 与「设置 → 模型」页的扩展并存，且从不成为激活门槛。该页不依赖别处选中的 provider：它通过同一设置作用域读取已配置的 `llm-pi-ai` provider，默认处理第一个（配置多个时可在页内切换），并在命名空间仍在读取、宿主未提供或尚未配置 provider 时明确说明。

- 默认仅补缺失参数；勾选「覆盖已有值」才替换差异值。
- 窗口顶部可启用一个所有 provider 共用的 models.dev 请求代理并编辑地址；它只影响下一次参数查询，不改变任何 LLM provider 的 `baseURL`。
- Host 只负责拉取并缓存 models.dev 目录（6 小时，支持公共代理或 `HTTPS_PROXY` 回退），不接触任何 LLM 配置与凭据。

匹配顺序：先按该 provider 的 **端点（`baseURL`）** 认领 models.dev 里同 `api` 的 vendor（`commandcode` 与 `goat-163` 共用 `api.commandcode.ai`，因此共用同一份官方记录），其次按路由名，最后按模型 id 的厂商前缀。

三者都认不出部署时，插件**不再直接判「未收录」**：只要目录里有其它 provider 收录了同名模型，就列出这些官方参数作为**候选**，默认折叠、可展开，每条都带它自己的上下文 / max 输出数值；点选后标记「已选」并计入写入内容。**候选永远不会自动选中，也永远不会在不点选的情况下写入** —— 同一个模型名可能被二十多个 provider 收录且数值各不相同，只有你知道这条路由实际指向哪一家。

反之，端点和路由名已经认出部署时不会给候选：那种情况该模型确实不在该部署的服务范围内，套用其它厂商的数值只会更错。目录里任何 provider 都没有收录的 id 仍标记为「未收录」且不写入。

## Install

```powershell
dsh plugin --profile web add dsh-model-params
```

Restart the existing DSH Web process afterwards: the Host scans the browser plugin roster at startup, so the provider-card control appears only after that restart. Then open **Settings → Models** and look for `models.dev 参数` on a configured provider card. Where the host also exposes the settings page seat, the same control is one click deep in **Settings** as **YOTK · Model Params**.

Local development, from this package directory:

```powershell
dsh plugin --profile web add .
```

Either form records the package in the profile's `dsh.profile.bundles`, which is what mounts the Host lookup route and serves the client bundle.

## Development

From this directory run:

```powershell
npm test
npm run check
npm pack --dry-run
```

## License

MIT
