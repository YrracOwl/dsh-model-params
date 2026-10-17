import test from 'node:test'
import assert from 'node:assert/strict'
import { lookupModels, parseModelsDevCatalog } from '../lib/modelsdev.js'

// One model id served by several catalog providers with DIFFERENT limits.
// These numbers are the real ones measured on models.dev (2026-10-17):
//   CommandCode  deepseek/deepseek-v4.1-flash -> 1000000 / 384000
//   SenseNova    deepseek-v4.1-flash          -> 1048576 / 65536
// The first two entries are ordered the way the catalog walk happens to return
// them, so "pick the first candidate" is exactly the wrong behaviour under test.
const MULTI = {
  sensenova: {
    id: 'sensenova', name: 'SenseNova (China)',
    models: {
      'deepseek-v4.1-flash': { id: 'deepseek-v4.1-flash', name: 'SenseNova V4.1', limit: { context: 1048576, output: 65536 } },
    },
  },
  nearai: {
    id: 'nearai', name: 'NEAR AI',
    models: {
      'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', name: 'NEAR V4.1', limit: { context: 131072, output: 8192 } },
    },
  },
  commandcode: {
    id: 'commandcode', name: 'CommandCode',
    models: {
      'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', limit: { context: 1000000, output: 384000 } },
    },
  },
}

const index = parseModelsDevCatalog(MULTI)

test('the route being edited decides which vendor\'s numbers are used', () => {
  // Without a route the id-prefix rule runs and cannot identify a deployment;
  // a wrong context window breaks requests far more confusingly than a miss.
  const blind = lookupModels(index, ['deepseek/deepseek-v4.1-flash'])
  assert.equal(blind.unmatched.length, 1, 'no route and no identifiable vendor -> unmatched, never a guess')
  assert.equal(blind.matched.length, 0)
})

test('a route that names a catalog provider wins over the id-prefix rule', () => {
  const hit = lookupModels(index, ['deepseek/deepseek-v4.1-flash'], { route: 'commandcode' })
  assert.equal(hit.matched.length, 1)
  assert.equal(hit.matched[0].providerId, 'commandcode')
  // The numbers that actually belong to this route:
  assert.equal(hit.matched[0].context, 1000000)
  assert.equal(hit.matched[0].maxOutput, 384000)
})

test('the route match is case-insensitive, like a settings route key', () => {
  const hit = lookupModels(index, ['deepseek/deepseek-v4.1-flash'], { route: 'CommandCode' })
  assert.equal(hit.matched[0].providerId, 'commandcode')
})

test('a route with no matching catalog provider falls back to the id-prefix rule', () => {
  // `open-design-go` is OUR route name; models.dev has no such provider. The id
  // `deepseek-v4.1-flash` then resolves through the prefix rule, which points at
  // `deepseek` — absent here, so nothing identifiable remains and the id is
  // reported unmatched rather than attached to an arbitrary vendor.
  const miss = lookupModels(index, ['deepseek-v4.1-flash'], { route: 'open-design-go' })
  assert.equal(miss.unmatched.length, 1)

  // But when the prefix rule DOES name a provider present in the catalog, it is
  // used: `gpt-*` -> openai.
  const withOpenai = parseModelsDevCatalog({
    ...MULTI,
    openai: {
      id: 'openai', name: 'OpenAI',
      models: { 'gpt-6.1-sol': { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', limit: { context: 1050000, output: 128000 } } },
    },
  })
  const viaHint = lookupModels(withOpenai, ['gpt-6.1-sol'], { route: 'my-gateway' })
  assert.equal(viaHint.matched.length, 1)
  assert.equal(viaHint.matched[0].providerId, 'openai')
  assert.equal(viaHint.matched[0].context, 1050000)
})

test('the route also drives the NEAR match, so a family id stays on its vendor', () => {
  // A route asks for the undated family id while the catalog only lists a dated
  // variant — the case the near match exists for. The vendor's own record is
  // used instead of reporting the id unmatched.
  const byId = parseModelsDevCatalog({
    commandcode: {
      id: 'commandcode', name: 'CommandCode',
      models: { 'deepseek/deepseek-v4.1-flash-1017': { id: 'deepseek/deepseek-v4.1-flash-1017', name: 'V4.1 1017', limit: { context: 1000000, output: 384000 } } },
    },
    sensenova: {
      id: 'sensenova', name: 'SenseNova',
      models: { 'deepseek-v4.1-flash': { id: 'deepseek-v4.1-flash', name: 'SenseNova V4.1', limit: { context: 1048576, output: 65536 } } },
    },
  })
  const hit = lookupModels(byId, ['deepseek/deepseek-v4.1-flash'], { route: 'commandcode' })
  assert.equal(hit.matched.length, 1, 'the family id resolves inside the route\'s vendor')
  assert.equal(hit.matched[0].providerId, 'commandcode')
  assert.equal(hit.matched[0].maxOutput, 384000, 'and takes the vendor\'s numbers, not SenseNova\'s')

  // An id that shares no substring with any catalog key stays unmatched rather
  // than being attached to an unrelated record.
  const far = lookupModels(byId, ['deepseek/deepseek-v4.1-flash-1101'], { route: 'commandcode' })
  assert.equal(far.unmatched.length, 1)
})

test('two routes for the same id get their own vendor\'s numbers', () => {
  const a = lookupModels(index, ['deepseek/deepseek-v4.1-flash'], { route: 'commandcode' })
  const b = lookupModels(index, ['deepseek/deepseek-v4.1-flash'], { route: 'nearai' })
  assert.equal(a.matched[0].maxOutput, 384000)
  assert.equal(b.matched[0].maxOutput, 8192)
  assert.notEqual(a.matched[0].maxOutput, b.matched[0].maxOutput, 'same id, different route, different facts')
})

test('a route absent from the catalog still resolves through the id vendor prefix', () => {
  // Our own route names are not in models.dev (`pipio-chat`, `open-design-go`).
  // The model id's vendor prefix must still identify the record, exactly as it
  // did before the route became part of the query — otherwise making the lookup
  // route-aware silently broke every custom route name. This is a regression I
  // introduced and caught live, so it is pinned here.
  const catalog = parseModelsDevCatalog({
    google: {
      id: 'google', name: 'Google',
      models: { 'gemini-3.8-flash': { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', limit: { context: 1048576, output: 65536 } } },
    },
    commandcode: {
      id: 'commandcode', name: 'CommandCode',
      models: { 'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', name: 'V4.1', limit: { context: 1000000, output: 384000 } } },
    },
  })
  // `gemini-3.8-flash-high` is the real route id; the catalog lists the undated
  // family `gemini-3.8-flash`, so this exercises the NEAR path as well.
  const hit = lookupModels(catalog, ['gemini-3.8-flash-high'], { route: 'pipio-chat' })
  assert.equal(hit.matched.length, 1, 'a custom route must not shadow the vendor prefix')
  assert.equal(hit.matched[0].providerId, 'google')
  assert.equal(hit.matched[0].context, 1048576)
})

test('the route wins over the vendor prefix when both could answer', () => {
  // `deepseek/...` hints at provider `deepseek`; a commandcode route must still
  // take CommandCode's record. Route specificity beats prefix guessing.
  const catalog = parseModelsDevCatalog({
    deepseek: {
      id: 'deepseek', name: 'DeepSeek',
      models: { 'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', name: 'Official', limit: { context: 999, output: 1 } } },
    },
    commandcode: {
      id: 'commandcode', name: 'CommandCode',
      models: { 'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', name: 'V4.1', limit: { context: 1000000, output: 384000 } } },
    },
  })
  const hit = lookupModels(catalog, ['deepseek/deepseek-v4.1-flash'], { route: 'commandcode' })
  assert.equal(hit.matched[0].providerId, 'commandcode', 'the route identifies the deployment')
  assert.equal(hit.matched[0].context, 1000000)
})
