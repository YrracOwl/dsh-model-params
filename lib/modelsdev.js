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
 * Pick the catalog record that belongs to the provider ROUTE being edited.
 *
 * The id-prefix hint alone is not enough. `deepseek/deepseek-v4.1-flash` served
 * through a `commandcode` route has the same id as the same model served by
 * SenseNova, Alibaba, nearai, nano-gpt and ~40 other catalog providers — and
 * their limits differ (measured: CommandCode reports 1000000/384000,
 * SenseNova 1048576/65536). Guessing from the id alone picked SenseNova for a
 * CommandCode route, which would have rewritten a correct configuration with
 * another vendor's numbers.
 *
 * So the route's own catalog provider is tried FIRST, by exact provider id
 * (case-insensitive): models.dev keys the `commandcode` provider with exactly
 * the model id this route uses. Only when the route names no such provider does
 * the id-prefix hint decide.
 *
 * @param {object[]} candidates - catalog records sharing this model id.
 * @param {string|undefined} route - the settings provider route being edited.
 * @param {string|undefined} hinted - provider id from the id-prefix rule.
 * @returns {object|undefined} the record to use.
 */
export function preferredCandidate(candidates, route, hinted) {
  if (candidates.length === 0) return undefined
  if (typeof route === 'string' && route.length > 0) {
    const byRoute = candidates.find((entry) => String(entry.providerId).toLowerCase() === route.toLowerCase())
    if (byRoute) return byRoute
  }
  if (hinted !== undefined) {
    const byHint = candidates.find((entry) => entry.providerId === hinted)
    if (byHint) return byHint
  }
  // Neither the route nor a hint identified a vendor. Returning a record here
  // would attach an arbitrary vendor's limits, so report the id as unmatched and
  // let the panel say so — a wrong context window breaks requests far more
  // confusingly than "models.dev 未收录".
  return undefined
}

/**
 * Match requested ids against the catalog. Keys tried are the full id and its
 * last path segment; within the identified provider a NEAR key also matches.
 * @param {Map<string, object[]>} index - parseModelsDevCatalog output.
 * @param {string[]} ids - gateway model ids.
 * @param {{ models?: object, defaults?: object, route?: string }} hints -
 *   optional provider hints. `route` is the settings provider route being
 *   edited and takes precedence over the id-prefix rule, because one model id is
 *   served by dozens of catalog providers with different limits.
 * @returns {{ matched: object[], unmatched: string[] }}
 */
export function lookupModels(index, ids, hints = {}) {
  const matched = []
  const unmatched = []
  for (const raw of ids || []) {
    const modelId = clean(raw)
    if (!modelId) continue
    const bare = modelId.slice(modelId.lastIndexOf('/') + 1)
    // Prefer un-prefixed (official vendor) records over gateway mirrors whose
    // catalog keys embed the same prefix ("deepseek/deepseek-v4-flash").
    const seen = new Set()
    const candidates = []
    for (const key of [bare, modelId]) {
      const lower = key.toLowerCase()
      const exact = index.get(lower)
      if (exact) {
        for (const entry of exact) {
          if (!seen.has(entry.providerId)) {
            seen.add(entry.providerId)
            candidates.push(entry)
          }
        }
      }
    }
    const hinted = hintedProviderOf(modelId, bare, hints)
    let selected = preferredCandidate(candidates, hints.route, hinted)
    if (!selected) {
      // Near match inside an IDENTIFIED vendor only: versioned ids such as
      // `deepseek-v4-flash-0731` resolve to that family's facts.
      //
      // Two vendors can be identified here, and BOTH are legitimate:
      //   • the route's own catalog provider (a `commandcode` route), and
      //   • the model id's vendor prefix (a `gemini-*` id under a route models.dev
      //     does not know, such as our own `pipio-chat`).
      // Filtering on the route alone turned that second case into a miss — the
      // route is not in the catalog, so nothing survived the filter and a model
      // that used to resolve through its vendor prefix stopped resolving.
      //
      // Compare on the whole ids, not on `bare` alone: a gateway that keys its
      // catalog copies with a vendor prefix (`deepseek/deepseek-v4.1-flash-1017`)
      // would otherwise never match a request carrying the same prefix.
      const routeKey = hints.route !== undefined ? String(hints.route).toLowerCase() : undefined
      const vendorKeys = [routeKey, hinted].filter((key) => key !== undefined)
      if (vendorKeys.length > 0) {
        const related = (a, b) => a.includes(b) || b.includes(a)
        const near = [...index.values()].flat()
          .filter((entry) => vendorKeys.includes(String(entry.providerId).toLowerCase()))
          .filter((entry) => related(entry.modelId, bare) || related(entry.modelId, modelId))
          // Prefer the route's own vendor when both could answer: it is the more
          // specific claim about which deployment this is.
          .sort((a, b) => {
            const aRoute = String(a.providerId).toLowerCase() === routeKey ? 0 : 1
            const bRoute = String(b.providerId).toLowerCase() === routeKey ? 0 : 1
            if (aRoute !== bRoute) return aRoute - bRoute
            return a.modelId.length - b.modelId.length
          })[0]
        selected = near
      }
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
