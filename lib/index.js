// dsh-model-params — Host half.
//
// One loopback/same-origin fenced endpoint:
//   GET /api/model-params/lookup?ids=a,b,c
// Loads https://models.dev/api.json (6h in-memory cache, optional HTTPS_PROXY
// fallback), matches each requested model id and returns the metadata-bearing
// entries (context / max output / reasoning effort values). The Client half
// renders the official provider-card extension; it never sends credentials
// and the Host never touches user LLM settings — writes happen on the Client
// through the official Settings scope of the provider namespace.

import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { lookupModels, parseModelsDevCatalog } from './modelsdev.js'

export const name = 'dsh-model-params'
export const inject = ['webServer']

const MODELS_DEV_URL = 'https://models.dev/api.json'
const FETCH_TIMEOUT_MS = 30_000
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_IDS = 100
const MAX_ID_LENGTH = 240

const caches = new Map() // proxy key -> { at: number, index: Map, fetchedAt: string }

function environmentProxyUrl() {
  return process.env.HTTPS_PROXY || process.env.https_proxy
}

function cleanProxyUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const url = value.trim()
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
    return url
  } catch {
    return undefined
  }
}

async function fetchCatalog(requestedProxy) {
  const proxy = requestedProxy === undefined ? environmentProxyUrl() : cleanProxyUrl(requestedProxy)
  if (requestedProxy !== undefined && !proxy) throw Object.assign(new Error('代理地址无效：请输入 http:// 或 https:// URL'), { status: 400 })
  const cacheKey = proxy || ''
  const now = Date.now()
  let cache = caches.get(cacheKey)
  if (cache && now - cache.at < CACHE_TTL_MS) return cache
  if (cache && cache.pending) {
    await cache.pending
    return cache
  }
  const pending = (async () => {
    const options = {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }
    const attempt = async (dispatcher) => {
      const request = dispatcher ? undiciFetch : fetch
      const response = await request(MODELS_DEV_URL, dispatcher ? { ...options, dispatcher } : options)
      if (!response.ok) throw new Error(`models.dev HTTP ${response.status}`)
      return response.json()
    }
    const save = (document) => {
      cache = { at: Date.now(), index: parseModelsDevCatalog(document), fetchedAt: new Date().toISOString(), pending: undefined }
      caches.set(cacheKey, cache)
      return cache
    }
    if (requestedProxy !== undefined) {
      const dispatcher = new ProxyAgent(proxy)
      try {
        return save(await attempt(dispatcher))
      } finally {
        void dispatcher.close().catch(() => {})
      }
    }
    try {
      return save(await attempt())
    } catch (error) {
      if (!proxy) throw error
      const dispatcher = new ProxyAgent(proxy)
      try {
        return save(await attempt(dispatcher))
      } catch (proxyError) {
        throw new Error(`models.dev fetch failed (direct and via proxy): ${String(error?.message || error)} / ${String(proxyError?.message || proxyError)}`)
      } finally {
        void dispatcher.close().catch(() => {})
      }
    }
  })()
  if (!cache) {
    cache = { at: now, index: undefined, fetchedAt: undefined, pending }
    caches.set(cacheKey, cache)
  } else {
    cache.pending = pending
  }
  try {
    await pending
  } finally {
    if (cache && cache.pending === pending) cache.pending = undefined
  }
  return cache
}

function parseIds(query) {
  const raw = typeof query === 'string' ? query : ''
  if (raw.length > 8000) throw Object.assign(new Error('query too large'), { status: 413 })
  const ids = raw.split(',').map((value) => value.trim()).filter(Boolean)
  if (ids.length > MAX_IDS) throw Object.assign(new Error('too many ids'), { status: 400 })
  if (ids.some((id) => id.length > MAX_ID_LENGTH)) throw Object.assign(new Error('id too long'), { status: 400 })
  return ids
}

function parseProxy(query) {
  const raw = typeof query === 'string' ? query.trim() : ''
  if (raw.length > 512) throw Object.assign(new Error('proxy URL too long'), { status: 400 })
  return raw || undefined
}

function originAllowed(req) {
  const origin = req.headers.origin
  if (!origin) return true
  const host = req.headers.host || ''
  const base = /^https?:\/\/([^/]+)/i.exec(origin)
  return !!base && base[1] === host
}

function hostAllowed(req) {
  let host = String(req.headers.host || '').split(':')[0].toLowerCase()
  host = host.replace(/^\[|\]$/g, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

export function apply(ctx) {
  const ws = ctx.webServer
  ctx.effect(() => ws.register({
    kind: 'exact',
    path: '/api/model-params/lookup',
    handler: async (req, res) => {
      if (!originAllowed(req) || !hostAllowed(req)) {
        json(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        const url = req.url ? new URL(req.url, 'http://local') : new URL('http://local')
        const ids = parseIds(url.searchParams.get('ids'))
        const proxy = url.searchParams.get('proxy') === null ? undefined : parseProxy(url.searchParams.get('proxy'))
        const current = await fetchCatalog(proxy)
        if (!current.index) throw new Error('models.dev catalog unavailable')
        const result = lookupModels(current.index, ids)
        json(res, 200, {
          ok: true,
          fetchedAt: current.fetchedAt,
          matched: result.matched,
          unmatched: result.unmatched,
        })
      } catch (error) {
        const status = Number(error && error.status) || 500
        json(res, status, { ok: false, error: String((error && error.message) || error) })
      }
    },
  }), 'dsh-model-params: lookup route')
}
