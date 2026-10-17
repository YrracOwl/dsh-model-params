import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_CANDIDATES, lookupModels, parseModelsDevCatalog, rankCandidates, relatedName } from '../lib/modelsdev.js'

// When NO signal identifies which deployment serves a route, the catalog still
// knows the model NAME — and that name carries each provider's own official
// numbers. Reporting "未收录" there withholds data the user can act on, so the
// lookup returns a MENU instead: `candidates`, never auto-applied. The distinction
// that matters is menu vs answer. A menu is a question; an answer is a write.
//
// Four providers list `deepseek-v4.1-flash`, with different numbers. None of them
// can be claimed for a route whose endpoint the catalog does not know.
const CATALOG = {
  commandcode: {
    id: 'commandcode', name: 'CommandCode', api: 'https://api.commandcode.ai/provider/v1',
    models: {
      'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', name: 'V4.1', limit: { context: 1000000, output: 384000 }, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] },
    },
  },
  sensenova: {
    id: 'sensenova', name: 'SenseNova', api: 'https://api.sensenova.cn/v1',
    models: {
      'deepseek-v4.1-flash': { id: 'deepseek-v4.1-flash', name: 'SenseNova V4.1', limit: { context: 1048576, output: 65536 } },
    },
  },
  aiinfra: {
    id: 'aiinfra', name: 'AI Infra', api: 'https://api.aiinfra.io/v1',
    models: {
      'deepseek-v4.1-flash': { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', limit: { context: 1000000, output: 393216 } },
    },
  },
  // A record with no numbers at all is dropped by the parser (nothing to fill in),
  // so an incomplete-but-usable record must rank below a complete one.
  tinyshop: {
    id: 'tinyshop', name: 'Tiny Shop', api: 'https://api.tinyshop.dev/v1',
    models: {
      'deepseek-v4.1-flash': { id: 'deepseek-v4.1-flash', name: 'DS', limit: { context: 4096 } },
    },
  },
  google: {
    id: 'google', name: 'Google', api: 'https://generativelanguage.googleapis.com/v1beta',
    models: {
      'gemini-3.8-flash': { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', limit: { context: 1048576, output: 65536 } },
    },
  },
}

const index = parseModelsDevCatalog(CATALOG)

test('an unmatched endpoint still yields the official parameters by model name', () => {
  // The real case: our `open-design-go` route points at a gateway models.dev does
  // not list, but the model id is one the catalog knows under other providers.
  const hit = lookupModels(index, ['deepseek-v4.1-flash'], {
    route: 'open-design-go',
    baseURL: 'https://amr-link.open-design.ai/v1',
  })
  assert.equal(hit.matched.length, 0, 'nothing identified the deployment, so nothing is asserted')
  assert.equal(hit.candidates.length, 1)
  assert.equal(hit.candidates[0].requested, 'deepseek-v4.1-flash')
  assert.equal(hit.candidates[0].options.length, 4, 'all four providers are offered')
  const ids = hit.candidates[0].options.map((option) => option.providerId).sort()
  assert.deepEqual(ids, ['aiinfra', 'commandcode', 'sensenova', 'tinyshop'])
  // A menu must not smuggle a decision in through ordering of the payload shape:
  // every option is a complete record the panel can render, and none is flagged
  // as chosen.
  for (const option of hit.candidates[0].options) {
    assert.equal(option.requested, undefined, 'options are catalog records, not matches')
  }
  assert.deepEqual(hit.unmatched, [], 'a listed name is not "unrecorded"')
})

test('the menu carries each provider\'s own numbers, unmerged', () => {
  const hit = lookupModels(index, ['deepseek-v4.1-flash'], { baseURL: 'https://unknown.example/v1' })
  const byId = new Map(hit.candidates[0].options.map((option) => [option.providerId, option]))
  assert.equal(byId.get('commandcode').maxOutput, 384000)
  assert.equal(byId.get('sensenova').maxOutput, 65536)
  assert.equal(byId.get('aiinfra').maxOutput, 393216)
  assert.deepEqual(byId.get('commandcode').efforts, ['low', 'high', 'max'])
  // No candidate is presented as the answer, so no `hinted` marker leaks out.
  for (const option of hit.candidates[0].options) assert.equal(option.hinted, undefined)
})

test('a known endpoint suppresses the menu: the deployment already answered', () => {
  // `byApi` is identified but does not list the requested id, and no vendor prefix
  // can rescue it. Offering another vendor's numbers here would be systematically
  // wrong — this deployment simply does not serve that model.
  const hit = lookupModels(index, ['totally-unlisted-model'], {
    route: 'commandcode',
    baseURL: 'https://api.commandcode.ai/provider/v1',
  })
  assert.equal(hit.matched.length, 0)
  assert.equal(hit.candidates.length, 0, 'no menu against a known endpoint')
  assert.deepEqual(hit.unmatched, ['totally-unlisted-model'])
})

test('a route NAMED after a catalog provider is an identified deployment too', () => {
  // Same rule as the endpoint, through the other identifying signal: the route is
  // `sensenova`, so an id that does not belong to it must not borrow another
  // vendor's record as a *match*. With no id prefix to identify a vendor, it is
  // reported unmatched rather than dressed up as sensenova's.
  const hit = lookupModels(index, ['totally-unlisted-model-0731'], { route: 'sensenova' })
  assert.equal(hit.matched.length, 0, 'the route names the deployment; do not answer from another')
  assert.equal(hit.candidates.length, 0)
  assert.deepEqual(hit.unmatched, ['totally-unlisted-model-0731'])
})

test('a route the catalog does not know still gets a menu', () => {
  const hit = lookupModels(index, ['deepseek-v4.1-flash'], { route: 'goat-163' })
  assert.equal(hit.candidates.length, 1)
  assert.equal(hit.candidates[0].options.length, 4)
})

test('the menu finds providers that key the model WITH a vendor prefix', () => {
  // The dropdown this replaced used an exact index lookup on the bare id, so
  // `commandcode` — which lists `deepseek/deepseek-v4.1-flash` — vanished from the
  // list even though it is exactly the gateway being configured. Recall is the
  // whole point of a menu.
  const hit = lookupModels(index, ['deepseek-v4.1-flash'], { route: 'mystery' })
  const ids = hit.candidates[0].options.map((option) => option.providerId)
  assert.ok(ids.includes('commandcode'), 'prefixed catalog keys must not be dropped')
  assert.ok(ids.includes('sensenova'), 'bare catalog keys must not be dropped either')
})

test('an affix variant is offered as an approximate candidate', () => {
  // `pipio-chat` requests `gemini-3.8-flash-high`; the catalog lists
  // `gemini-3.8-flash`. With the endpoint unknown, the near name is what we have.
  const hit = lookupModels(index, ['gemini-3.8-flash-high'], {
    route: 'pipio-chat',
    baseURL: 'https://pipio.io/v1',
  })
  // The id prefix still identifies Google, so this is a real match, not a menu.
  assert.equal(hit.matched.length, 1)
  assert.equal(hit.matched[0].providerId, 'google')

  // With no vendor prefix to lean on, the same shape becomes a menu.
  const near = lookupModels(index, ['deepseek-v4.1-flash-next'], { route: 'mystery' })
  assert.equal(near.candidates.length, 1)
  assert.equal(near.candidates[0].near, true, 'flagged so the panel can say the name differs')
  assert.equal(near.candidates[0].options[0].providerId !== undefined, true)
})

test('an id with no relation at all is not dressed up as a candidate', () => {
  const hit = lookupModels(index, ['totally-different-model'], { route: 'mystery' })
  assert.equal(hit.candidates.length, 0)
  assert.deepEqual(hit.unmatched, ['totally-different-model'])
})

test('relatedName only accepts a short affix, never a shared substring', () => {
  assert.equal(relatedName('gemini-3.8-flash', 'gemini-3.8-flash-high'), true)
  assert.equal(relatedName('deepseek-v4.1-flash', 'deepseek-v4.1-flash-1017'), true)
  assert.equal(relatedName('glm-5.3-flash', 'z-ai/glm-5.3-flash'), false, 'a vendor prefix is not an affix')
  // Prefix-of relationship, not containment: these share text but neither starts
  // with the other.
  assert.equal(relatedName('gpt-5-flash', 'gpt-5-flash-mini-extended'), false, 'the affix is too long to be a version')
  assert.equal(relatedName('', 'x'), false)
  assert.equal(relatedName(undefined, 'x'), false)
})

test('candidates rank complete records first and cap the menu', () => {
  // A record with no numbers cannot fill anything in, so it must not lead a menu
  // a human is reading top-down.
  const ordered = rankCandidates([
    { providerId: 'zulu', modelId: 'm', context: undefined, maxOutput: undefined },
    { providerId: 'alpha', modelId: 'm', context: 1000, maxOutput: 100 },
    { providerId: 'bravo', modelId: 'm', context: 1000 },
  ])
  assert.deepEqual(ordered.map((entry) => entry.providerId), ['alpha', 'bravo', 'zulu'])

  // Ties break on provider id, so the order is stable between requests.
  const tied = rankCandidates([
    { providerId: 'zulu', modelId: 'm', context: 1, maxOutput: 1 },
    { providerId: 'alpha', modelId: 'm', context: 1, maxOutput: 1 },
  ])
  assert.deepEqual(tied.map((entry) => entry.providerId), ['alpha', 'zulu'])

  // A model id served by many providers is truncated, not returned in full.
  const many = parseModelsDevCatalog(Object.fromEntries(
    Array.from({ length: MAX_CANDIDATES + 4 }, (_, i) => ['p' + i, {
      id: 'p' + i, name: 'P' + i, api: 'https://p' + i + '.example/v1',
      models: { shared: { id: 'shared', name: 'S', limit: { context: 1000, output: 10 } } },
    }]),
  ))
  const hit = lookupModels(many, ['shared'], { baseURL: 'https://nowhere.example/v1' })
  assert.equal(hit.candidates[0].options.length, MAX_CANDIDATES)
})
