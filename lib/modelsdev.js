// dsh-model-params — pure models.dev catalog parsing and matching helpers.
//
// REAL models.dev/api.json shape (verified live):
//   root = flat provider map { <id>: { id, name, ..., models: {
//     <modelId>: { id, name, family, reasoning?, reasoning_options?:
//         [ {type:'toggle'}, {type:'effort', values:[...]} ], limit?: { context?, output? } } } } }
//
// Matching mirrors the upstream dsh-llm-newapi approach: keys tried are the
// full gateway id and its last path segment; family-prefix hints decide which
// catalog provider leads; inside the hinted provider a NEAR key (one side
// contains the other) still yields facts for versioned ids like
// `deepseek-v4-flash-0731`. Reasoning-effort values are intersected with the
// pi-ai THINKING_LEVELS space so writes can never fail schema validation.

export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Family-prefix → catalog provider, mirroring upstream defaults. */
export const DEFAULT_PROVIDER_HINTS = Object.freeze({
  glm: 'zai',
  gpt: 'openai',
  o: 'openai',
  claude: 'anthropic',
  deepseek: 'deepseek',
  gemini: 'google',
  grok: 'xai',
  hunyuan: 'tencent',
  qwen: 'alibaba',
  kimi: 'moonshotai',
  mimo: 'xiaomi',
  minimax: 'minimax',
})

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0
const clean = (value) => nonEmpty(value) ? value.trim() : undefined
const positiveInt = (value) => Number.isSafeInteger(value) && value > 0 ? value : undefined

/**
 * Parse a models.dev document into a detached map keyed by lower-cased model
 * id. Tolerant of both the real flat-provider root and a `{providers}` wrap.
 * @returns {Map<string, object[]>} entries with providerId/providerName/modelId/name/context/maxOutput/efforts.
 */
export function parseModelsDevCatalog(document) {
  const root0 = document && typeof document === 'object' ? document : {}
  const providersRoot = root0.providers && typeof root0.providers === 'object' && !Array.isArray(root0.providers)
    ? root0.providers
    : root0
  const byId = new Map()
  for (const [providerId, provider] of Object.entries(providersRoot)) {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider.models)) continue
    const providerName = clean(provider.name) || clean(provider.id) || providerId
    const models = provider.models && typeof provider.models === 'object' ? provider.models : {}
    for (const [key, model] of Object.entries(models)) {
      if (!model || typeof model !== 'object') continue
      const modelId = clean(model.id) || clean(key)
      if (!modelId) continue
      const limit = model.limit && typeof model.limit === 'object' ? model.limit : {}
      const context = positiveInt(limit.context)
      const output = positiveInt(limit.output)
      const efforts = []
      const options = Array.isArray(model.reasoning_options) ? model.reasoning_options : []
      for (const option of options) {
        if (!option || option.type !== 'effort' || !Array.isArray(option.values)) continue
        for (const value of option.values) {
          const id = clean(value)
          if (id && !efforts.includes(id)) efforts.push(id)
        }
      }
      if (context === undefined && output === undefined && efforts.length === 0) continue
      const entry = {
        providerId,
        providerName,
        modelId,
        name: clean(model.name) || modelId,
        ...(context !== undefined ? { context } : {}),
        ...(output !== undefined ? { maxOutput: output } : {}),
        ...(efforts.length ? { efforts } : {}),
      }
      const list = byId.get(modelId.toLowerCase())
      if (list) list.push(entry)
      else byId.set(modelId.toLowerCase(), [entry])
    }
  }
  return byId
}

/** Provider hinted for one gateway id by exact model rule or longest prefix. */
export function hintedProviderOf(id, bare, hints = {}) {
  const exact = hints.models ? (hints.models[id] || hints.models[bare]) : undefined
  if (exact) return exact
  const lower = String(bare).toLowerCase()
  const entries = Object.entries({ ...DEFAULT_PROVIDER_HINTS, ...(hints.defaults || {}) })
  const hit = entries
    .filter(([prefix]) => lower.startsWith(prefix.toLowerCase()))
    .sort((a, b) => b[0].length - a[0].length)[0]
  return hit ? hit[1] : undefined
}

/**
 * Match requested ids against the catalog. Keys tried are the full id and its
 * last path segment; within the hinted provider a NEAR key also matches.
 * @param {Map<string, object[]>} index - parseModelsDevCatalog output.
 * @param {string[]} ids - gateway model ids.
 * @param {{ models?: object, defaults?: object }} hints - optional provider hints.
 * @returns {{ matched: object[], unmatched: string[] }}
 */
export function lookupModels(index, ids, hints = {}) {
  const matched = []
  const unmatched = []
  for (const raw of ids || []) {
    const modelId = clean(raw)
    if (!modelId) continue
    const bare = modelId.slice(modelId.lastIndexOf('/') + 1)
    const exact = index.get(modelId.toLowerCase()) || index.get(bare.toLowerCase())
    const hinted = hintedProviderOf(modelId, bare, hints)
    let selected
    if (exact) {
      const hintedEntry = exact.find((entry) => entry.providerId === hinted)
      selected = hintedEntry || exact[0]
    } else if (hinted) {
      // Near match inside the hinted vendor only: versioned ids such as
      // `deepseek-v4-flash-0731` resolve to the family's facts.
      const candidates = [...index.values()].flat().filter((entry) => entry.providerId === hinted)
      const near = candidates
        .filter((entry) => entry.modelId.includes(bare) || bare.includes(entry.modelId))
        .sort((a, b) => a.modelId.length - b.modelId.length)[0]
      selected = near
    }
    if (!selected) {
      unmatched.push(modelId)
      continue
    }
    matched.push({ requested: modelId, ...selected, ...(selected.providerId === hinted ? { hinted: true } : {}) })
  }
  return { matched, unmatched }
}

/** Restrict raw models.dev effort values to the pi-ai thinking-level space. */
export function intersectEfforts(efforts, levels = THINKING_LEVELS) {
  return (efforts || []).filter((value) => levels.includes(value))
}
