// dsh-model-params — pure models.dev catalog parsing and matching helpers.
//
// models.dev/api.json shape (defensive reads only):
//   { providers: { <id>: { id, name, models: [ { id, name, limit?: { context?, output? },
//       reasoning_options?: [ { type: 'effort', values?: string[] } ] } ] } } }
//
// A requested model id may carry a vendor prefix ("z-ai/glm-5.3-flash",
// "deepseek/deepseek-v4-flash"). Matching therefore tries the exact id first
// and then the segment after the last "/". Reasoning-effort values offered by
// models.dev are intersected with the pi-ai THINKING_LEVELS key space
// (off/minimal/low/medium/high/xhigh/max) so a write can never fail schema
// validation.

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0
const clean = (value) => nonEmpty(value) ? value.trim() : undefined
const positiveInt = (value) => Number.isSafeInteger(value) && value > 0 ? value : undefined

/** Parse one models.dev catalog document into a detached match index. */
export function parseModelsDevCatalog(document) {
  const root = document && typeof document === 'object' ? document : {}
  const providers = root.providers && typeof root.providers === 'object' && !Array.isArray(root.providers) ? root.providers : {}
  const byId = new Map()
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== 'object') continue
    const providerName = clean(provider.name) || clean(provider.id) || providerId
    const models = Array.isArray(provider.models) ? provider.models : []
    for (const model of models) {
      if (!model || typeof model !== 'object') continue
      const modelId = clean(model.id)
      if (!modelId) continue
      const limit = model.limit && typeof model.limit === 'object' ? model.limit : {}
      const context = positiveInt(limit.context)
      const output = positiveInt(limit.output)
      let efforts = []
      const options = Array.isArray(model.reasoning_options) ? model.reasoning_options : []
      for (const option of options) {
        if (!option || option.type !== 'effort' || !Array.isArray(option.values)) continue
        for (const value of option.values) {
          const id = clean(value)
          if (id && !efforts.includes(id)) efforts.push(id)
        }
      }
      if (context === undefined && output === undefined && efforts.length === 0) continue
      const key = modelId.toLowerCase()
      const entry = {
        providerId,
        providerName,
        modelId,
        name: clean(model.name) || modelId,
        ...(context !== undefined ? { context } : {}),
        ...(output !== undefined ? { maxOutput: output } : {}),
        ...(efforts.length ? { efforts } : {}),
      }
      const list = byId.get(key)
      if (list) list.push(entry)
      else byId.set(key, [entry])
    }
  }
  return byId
}

/** Prefer the entry whose provider matches a hint; otherwise the first. */
function pickEntry(entries, hint) {
  if (entries.length <= 1) return entries[0]
  const lower = hint ? String(hint).toLowerCase() : ''
  if (lower) {
    const preferred = entries.find((entry) =>
      entry.providerId.toLowerCase().includes(lower) || lower.includes(entry.providerId.toLowerCase()))
    if (preferred) return preferred
  }
  return entries[0]
}

/**
 * Look up requested model ids. Returns entries only for ids with at least one
 * metadata-bearing models.dev record; every other id is reported as unmatched.
 * @param {Map<string, object[]>} index - output of parseModelsDevCatalog.
 * @param {string[]} ids - configured model ids (vendor prefixes allowed).
 * @param {(id: string) => string|undefined} hintFor - optional provider hint per id.
 * @returns {{ matched: object[], unmatched: string[] }}
 */
export function lookupModels(index, ids, hintFor = () => undefined) {
  const matched = []
  const unmatched = []
  for (const raw of ids || []) {
    const modelId = clean(raw)
    if (!modelId) continue
    const exact = index.get(modelId.toLowerCase())
    const base = modelId.slice(modelId.lastIndexOf('/') + 1)
    const byBase = base !== modelId ? index.get(base.toLowerCase()) : undefined
    const entries = byBase && byBase.length && (!exact || byBase.length < exact.length) ? byBase : exact
    if (!entries || !entries.length) {
      unmatched.push(modelId)
      continue
    }
    matched.push({ requested: modelId, ...pickEntry(entries, hintFor(modelId)) })
  }
  return { matched, unmatched }
}

/** Restrict raw models.dev effort values to the pi-ai thinking-level space. */
export function intersectEfforts(efforts, levels = THINKING_LEVELS) {
  return (efforts || []).filter((value) => levels.includes(value))
}
