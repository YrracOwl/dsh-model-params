# dsh-model-params

## English

**Current release: 0.1.0** — models.dev parameter assistant inside the official DeepSeek Harness Models settings page.

For every configured `llm-pi-ai` provider card (custom OpenAI-compatible gateways such as the ones you add under Settings → Models), a `models.dev 参数` control fetches the official models.dev records for the provider's configured model ids and proposes the metadata pi-ai needs: context window, max output tokens, and reasoning-effort levels. One click writes the merged `models` array back to that provider profile through the official revision-aware Settings API.

Safety boundaries:

- The control never auto-writes. You open the panel, review the per-model diff, then click **应用并写入该 provider** — it writes only that provider's `models` array in the `llm-pi-ai` namespace.
- Default policy fills **missing** parameters only; tick **覆盖已有值** to also replace differing ones.
- Nothing leaves the machine except the models.dev catalog request (Host side, optional `HTTPS_PROXY`), and no credentials are ever sent.
- Models whose id models.dev does not know are reported as 未收录 and left untouched.

models.dev model ids may collide across catalog providers; the matcher prefers the record whose provider id relates to the model id's vendor prefix and otherwise takes the first metadata-bearing record.

## 中文

面向 DeepSeek Harness Web 官方 **设置 → 模型** 页的 models.dev 参数助手。每个已配置的 `llm-pi-ai` provider 卡片内提供 `models.dev 参数` 入口：按该 provider 的模型 id 在 models.dev 官方目录中匹配，预览上下文窗口 / max 输出 / 推理档位，确认后一次性写回该 provider 的 `models` 配置（官方 revision-aware Settings API，仅写 `llm-pi-ai` 命名空间下当前 provider 的数组）。

- 默认仅补缺失参数；勾选「覆盖已有值」才替换差异值。
- Host 只负责拉取并缓存 models.dev 目录（6 小时，支持 `HTTPS_PROXY`），不接触任何 LLM 配置与凭据。
- models.dev 未收录的模型 id 会明确标记，不写入。

## Development

From this directory run:

```powershell
npm test
npm run check
npm pack --dry-run
```

## License

MIT
