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
    // `api` is the provider's endpoint URL. It is what actually identifies a
    // deployment: two of our routes (`commandcode`, `goat-163`) are the SAME
    // gateway under different account names, so they share one baseURL and must
    // share one catalog record. Route names are ours; the endpoint is not.
    const api = clean(provider.api)
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
        ...(api !== undefined ? { api } : {}),
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
 * Normalise an endpoint for comparison: scheme, host and path matter, but a
 * trailing slash, case, and default ports do not.
 * @param {unknown} value
 * @returns {string|undefined}
 */
export function normalizeApi(value) {
  const text = clean(value)
  if (text === undefined) return undefined
  let url
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host.toLowerCase()}${path}`.toLowerCase()
}

/**
 * The catalog provider whose endpoint is this route's baseURL.
 *
 * This is the most authoritative signal available, because it identifies the
 * DEPLOYMENT rather than a name:
 *   • route names are ours (`goat-163`, `open-design-go`) and need not appear in
 *     models.dev at all;
 *   • one endpoint may be configured under several account names —
 *     `commandcode` and `goat-163` are the same `api.commandcode.ai` gateway, so
 *     both must resolve to the catalog's `commandcode` record;
 *   • the endpoint is what actually serves the numbers, so it decides when it
 *     can.
 *
 * @param {Map<string, object[]>} index - parseModelsDevCatalog output.
 * @param {string|undefined} baseURL - the route's configured baseURL.
 * @returns {string|undefined} catalog provider id.
 */
export function providerByBaseURL(index, baseURL) {
  const want = normalizeApi(baseURL)
  if (want === undefined) return undefined
  const seen = new Set()
  for (const entries of index.values()) {
    for (const entry of entries) {
      if (entry.api === undefined || seen.has(entry.providerId)) continue
      seen.add(entry.providerId)
      if (normalizeApi(entry.api) === want) return entry.providerId
    }
  }
  return undefined
}

/**
 * Pick the catalog record that belongs to the provider route being edited.
 *
 * The id-prefix hint alone is not enough. `deepseek/deepseek-v4.1-flash` served
 * through a `commandcode` route has the same id as the same model served by
 * SenseNova, Alibaba, nearai, nano-gpt and ~40 other catalog providers — and
 * their limits differ (measured: CommandCode reports 1000000/384000,
 * SenseNova 1048576/65536). Guessing from the id alone picked SenseNova for a
 * CommandCode route, which would have rewritten a correct configuration with
 * another vendor's numbers.
 *
 * Order of authority:
 *   1. the route's baseURL endpoint (see {@link providerByBaseURL}) — the
 *      deployment itself;
 *   2. the route id, when it happens to name a catalog provider;
 *   3. the id-prefix hint.
 *
 * @param {object[]} candidates - catalog records sharing this model id.
 * @param {{ baseURL?: string, route?: string }} hints - the route being edited.
 * @param {string|undefined} hinted - provider id from the id-prefix rule.
 * @param {string|undefined} byApi - provider id resolved from baseURL.
 * @returns {object|undefined} the record to use.
 */
export function preferredCandidate(candidates, hints, hinted, byApi) {
  if (candidates.length === 0) return undefined
  if (byApi !== undefined) {
    const byEndpoint = candidates.find((entry) => entry.providerId === byApi)
    if (byEndpoint) return byEndpoint
  }
  const route = hints && typeof hints.route === 'string' ? hints.route : undefined
  if (route !== undefined && route.length > 0) {
    const byRoute = candidates.find((entry) => String(entry.providerId).toLowerCase() === route.toLowerCase())
    if (byRoute) return byRoute
  }
  if (hinted !== undefined) {
    const byHint = candidates.find((entry) => entry.providerId === hinted)
    if (byHint) return byHint
  }
  // None of the three identified a vendor. Returning a record here would attach
  // an arbitrary vendor's limits, so report the id as unmatched and let the
  // panel say so — a wrong context window breaks requests far more confusingly
  // than "models.dev 未收录".
  return undefined
}

/**
 * Every catalog record that names the SAME model as this id, keyed by the name
 * after the last `/`.
 *
 * The menu must be built this way rather than from `index.get(bare)`: a gateway
 * may key its copy with a vendor prefix (`commandcode` lists this model as
 * `deepseek/deepseek-v4.1-flash`, not `deepseek-v4.1-flash`), and an exact-key
 * lookup silently dropped it from the list while the request carried the bare
 * name. Recall is the whole point of a menu.
 *
 * @param {Map<string, object[]>} index
 * @param {string} modelId - the requested id.
 * @returns {object[]} one record per provider, in catalog order.
 */
export function recordsOfName(index, modelId) {
  const want = String(modelId).toLowerCase()
  const bare = want.slice(want.lastIndexOf('/') + 1)
  const out = []
  const seen = new Set()
  for (const entries of index.values()) {
    for (const entry of entries) {
      const key = String(entry.modelId).toLowerCase()
      const tail = key.slice(key.lastIndexOf('/') + 1)
      if (tail !== bare) continue
      if (seen.has(entry.providerId)) continue
      seen.add(entry.providerId)
      out.push(entry)
    }
  }
  return out
}

/** How many name-only candidates one record carries to the client.
 *
 * One popular model name can be listed by 24+ providers, and truncating to a
 * handful cuts the RIGHT one off as often as not (alphabetical order put
 * CommandCode past the cut for `deepseek-v4.1-flash`). The panel scrolls, so the
 * cap exists only to bound the payload, not to curate.
 */
export const MAX_CANDIDATES = 32
/** Longest trailing affix still counted as "the same model, another version". */
const MAX_AFFIX = 12

/**
 * Whether two model ids differ only by an affix (`gemini-3.8-flash-high` vs the
 * catalog's `gemini-3.8-flash`).
 *
 * Deliberately stricter than "one contains the other": that admitted ids which
 * merely share a long substring, so an unrelated model could be offered as if it
 * were this one under another name. Here one id must be a PREFIX of the other and
 * the remainder must be short — a version, a size or a level suffix, never a
 * different model family.
 */
export function relatedName(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length === 0 || !long.startsWith(short)) return false
  return long.length - short.length <= MAX_AFFIX
}

/**
 * Presentation order for name-only candidates. Nothing here has identified the
 * vendor, so the list must not pretend to: it ranks by how closely a record
 * matches what was ASKED FOR, never by which vendor we suspect.
 *
 *   1. an exact model-id match ahead of an affix variant — a record under the very
 *      name requested is the closest thing to an answer;
 *   2. records that declare limits ahead of ones that do not, because a menu a
 *      human reads to pick numbers must show numbers;
 *   3. provider id, so the order is stable between requests.
 * @param {object[]} candidates
 * @param {string} [requested] - the id asked for, used to rank exact matches first.
 * @returns {object[]}
 */
export function rankCandidates(candidates, requested) {
  const want = typeof requested === 'string' ? requested.toLowerCase() : undefined
  const bare = want === undefined ? undefined : want.slice(want.lastIndexOf('/') + 1)
  const completeness = (entry) => (entry.context !== undefined ? 4 : 0)
    + (entry.maxOutput !== undefined ? 2 : 0)
    + (entry.efforts !== undefined ? 1 : 0)
  return [...candidates].sort((a, b) => {
    if (bare !== undefined) {
      // An exact name beats a suffixed variant of it.
      const exact = Number(String(b.modelId).toLowerCase().endsWith(bare)) - Number(String(a.modelId).toLowerCase().endsWith(bare))
      if (exact !== 0) return exact
    }
    const full = completeness(b) - completeness(a)
    if (full !== 0) return full
    const id = String(a.providerId).localeCompare(String(b.providerId))
    if (id !== 0) return id
    return a.modelId.length - b.modelId.length
  })
}

/**
 * Match requested ids against the catalog. Keys tried are the full id and its
 * last path segment; within the identified provider a NEAR key also matches.
 * @param {Map<string, object[]>} index - parseModelsDevCatalog output.
 * @param {string[]} ids - gateway model ids.
 * @param {{ models?: object, defaults?: object, route?: string, baseURL?: string }} hints -
 *   optional provider hints. `baseURL` is the route's configured endpoint and is
 *   the strongest signal (it identifies the deployment, and two account names on
 *   one gateway share it); `route` is the settings provider route being edited.
 *   Both take precedence over the id-prefix rule, because one model id is served
 *   by dozens of catalog providers with different limits.
 * @returns {{ matched: object[], candidates: object[], unmatched: string[] }}
 *   `candidates` carries the providers that DO list the id when nothing could
 *   identify which vendor serves this route. They are a menu, never a pick: the
 *   caller must show them and a human chooses, because selecting one here would
 *   be exactly the blind guess `unmatched` used to prevent.
 */
export function lookupModels(index, ids, hints = {}) {
  const matched = []
  const candidatesOut = []
  const unmatched = []
  const byApi = providerByBaseURL(index, hints.baseURL)
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
    let selected = preferredCandidate(candidates, hints, hinted, byApi)
    if (!selected) {
      // Near match inside an IDENTIFIED vendor only: versioned ids such as
      // `deepseek-v4-flash-0731` resolve to that family's facts.
      //
      // Three vendors can be identified here, and all are legitimate:
      //   • the route's endpoint (`commandcode` for both our commandcode and
      //     goat-163 routes — one gateway, two account names),
      //   • the route's own catalog provider name, and
      //   • the model id's vendor prefix (a `gemini-*` id under a route models.dev
      //     does not know, such as our own `pipio-chat`).
      // Filtering on any single one of them turned the others into misses.
      //
      // Compare on the whole ids, not on `bare` alone: a gateway that keys its
      // catalog copies with a vendor prefix (`deepseek/deepseek-v4.1-flash-1017`)
      // would otherwise never match a request carrying the same prefix.
      const routeKey = hints.route !== undefined ? String(hints.route).toLowerCase() : undefined
      const vendorKeys = [byApi, routeKey, hinted].filter((key) => key !== undefined)
      if (vendorKeys.length > 0) {
        const related = (a, b) => a.includes(b) || b.includes(a)
        // Rank by how specific the evidence is: endpoint first, then route name,
        // then the id prefix.
        const rank = (providerId) => {
          const key = String(providerId).toLowerCase()
          if (byApi !== undefined && key === byApi.toLowerCase()) return 0
          if (routeKey !== undefined && key === routeKey) return 1
          return 2
        }
        const near = [...index.values()].flat()
          .filter((entry) => vendorKeys.some((key) => String(key).toLowerCase() === String(entry.providerId).toLowerCase()))
          .filter((entry) => related(entry.modelId, bare) || related(entry.modelId, modelId))
          .sort((a, b) => {
            const byRank = rank(a.providerId) - rank(b.providerId)
            if (byRank !== 0) return byRank
            return a.modelId.length - b.modelId.length
          })[0]
        selected = near
      }
    }
    if (!selected) {
      // Nothing identified the DEPLOYMENT, but the id itself is listed by other
      // providers. That is not an answer — their numbers belong to their
      // endpoint — yet it IS the official parameter set for that model NAME,
      // which is what the user is asking to see. So hand the menu over; a human
      // picks.
      //
      // Only when the endpoint identified nothing. If `byApi` is known, the
      // gateway itself is a catalog provider that does not list this model, and
      // offering other vendors' numbers would be systematically wrong: the model
      // is not served by that deployment under any name.
      if (byApi === undefined) {
        const routeKey0 = hints.route !== undefined ? String(hints.route).toLowerCase() : undefined
        // The route's own name may BE a catalog provider (a route called
        // `commandcode` pointing at a gateway models.dev does not list by
        // endpoint). That identifies the deployment just as well, so its vendor
        // record — not another vendor's — is the only answer here.
        const routeIsProvider = routeKey0 !== undefined
          && [...index.values()].some((entries) => entries.some((entry) => String(entry.providerId).toLowerCase() === routeKey0))
        if (!routeIsProvider) {
          // Every provider naming this model — by the name after the last `/`, so
          // a gateway that keys its copy with a vendor prefix is not dropped.
          const named = recordsOfName(index, modelId)
          if (named.length > 0) {
            candidatesOut.push({ requested: modelId, options: rankCandidates(named, modelId).slice(0, MAX_CANDIDATES) })
            continue
          }
          // No record carries this exact id, but the catalog may list the same
          // model under a versioned or suffixed name (`gemini-3.8-flash-high` vs
          // `gemini-3.8-flash`). Offer those too, flagged as approximate so the
          // panel can say the name did not match exactly.
          const names = [...index.values()].flat().filter((entry) => relatedName(entry.modelId, bare) || relatedName(entry.modelId, modelId))
          if (names.length > 0) {
            candidatesOut.push({ requested: modelId, options: rankCandidates(names, modelId).slice(0, MAX_CANDIDATES), near: true })
            continue
          }
        }
      }
      unmatched.push(modelId)
      continue
    }
    matched.push({ requested: modelId, ...selected, ...(selected.providerId === hinted ? { hinted: true } : {}) })
  }
  return { matched, candidates: candidatesOut, unmatched }
}

/** Restrict raw models.dev effort values to the pi-ai thinking-level space. */
export function intersectEfforts(efforts, levels = THINKING_LEVELS) {
  return (efforts || []).filter((value) => levels.includes(value))
}
