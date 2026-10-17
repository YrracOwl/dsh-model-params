import test from 'node:test'
import assert from 'node:assert/strict'
import { lookupModels, normalizeApi, parseModelsDevCatalog, providerByBaseURL } from '../lib/modelsdev.js'

// models.dev providers carry an `api` endpoint. That endpoint — not the route
// name and not the model id — is what identifies the deployment:
//   • route names are OURS (`goat-163`, `open-design-go`) and need not appear in
//     the catalog at all;
//   • one gateway can be configured under several account names, which must
//     share one catalog record;
//   • the endpoint is what actually serves the numbers.
const CATALOG = {
  commandcode: {
    id: 'commandcode', name: 'CommandCode', api: 'https://api.commandcode.ai/provider/v1',
    models: {
      'deepseek/deepseek-v4.1-flash': { id: 'deepseek/deepseek-v4.1-flash', name: 'V4.1', limit: { context: 1000000, output: 384000 } },
    },
  },
  sensenova: {
    id: 'sensenova', name: 'SenseNova', api: 'https://api.sensenova.cn/v1',
    models: {
      'deepseek-v4.1-flash': { id: 'deepseek-v4.1-flash', name: 'SenseNova V4.1', limit: { context: 1048576, output: 65536 } },
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

test('normalizeApi compares the endpoint, not its spelling', () => {
  assert.equal(
    normalizeApi('https://api.commandcode.ai/provider/v1/'),
    normalizeApi('HTTPS://API.CommandCode.AI/provider/v1'),
    'trailing slash and case are not part of the identity',
  )
  assert.notEqual(normalizeApi('https://api.commandcode.ai/provider/v1'), normalizeApi('https://api.commandcode.ai/provider/v2'))
  assert.equal(normalizeApi('not a url'), undefined)
  assert.equal(normalizeApi(undefined), undefined)
})

test('an endpoint resolves to its catalog provider', () => {
  assert.equal(providerByBaseURL(index, 'https://api.commandcode.ai/provider/v1'), 'commandcode')
  assert.equal(providerByBaseURL(index, 'https://api.commandcode.ai/provider/v1/'), 'commandcode')
  // An endpoint the catalog does not know identifies nothing.
  assert.equal(providerByBaseURL(index, 'https://pipio.io/v1'), undefined)
  assert.equal(providerByBaseURL(index, ''), undefined)
})

test('two account names on one gateway share one catalog record', () => {
  // This is the real shape of the profile: `commandcode` and `goat-163` are the
  // same `api.commandcode.ai` gateway under two credentials. Both must resolve,
  // and both must get the SAME numbers — no per-route table needed.
  const shared = 'https://api.commandcode.ai/provider/v1'
  for (const route of ['commandcode', 'goat-163']) {
    const hit = lookupModels(index, ['deepseek/deepseek-v4.1-flash'], { route, baseURL: shared })
    assert.equal(hit.matched.length, 1, route + ' must resolve')
    assert.equal(hit.matched[0].providerId, 'commandcode')
    assert.equal(hit.matched[0].context, 1000000)
    assert.equal(hit.matched[0].maxOutput, 384000)
  }
})

test('the endpoint outranks a route name that points elsewhere', () => {
  // A route named `commandcode` but pointed at SenseNova's endpoint must take
  // SenseNova's numbers: the endpoint is what serves the requests.
  const hit = lookupModels(index, ['deepseek/deepseek-v4.1-flash'], {
    route: 'commandcode',
    baseURL: 'https://api.sensenova.cn/v1',
  })
  assert.equal(hit.matched[0].providerId, 'sensenova')
  assert.equal(hit.matched[0].maxOutput, 65536)
})

test('an unknown endpoint still falls through to route, then to the id prefix', () => {
  // Our `pipio-chat` route: not in the catalog, endpoint not in the catalog. The
  // model id's vendor prefix must still resolve it — this is the regression that
  // 0.1.9 introduced and 0.1.10 fixed, now with an endpoint in play.
  const hit = lookupModels(index, ['gemini-3.8-flash-high'], {
    route: 'pipio-chat',
    baseURL: 'https://pipio.io/v1',
  })
  assert.equal(hit.matched.length, 1)
  assert.equal(hit.matched[0].providerId, 'google')
  assert.equal(hit.matched[0].context, 1048576)
})

test('the endpoint also drives the near match', () => {
  // Undated family id requested; the catalog lists a dated variant under the
  // same endpoint. The endpoint identifies the vendor, so the near match stays
  // on it instead of wandering to another provider's record.
  const dated = parseModelsDevCatalog({
    ...CATALOG,
    commandcode: {
      id: 'commandcode', name: 'CommandCode', api: 'https://api.commandcode.ai/provider/v1',
      models: {
        'deepseek/deepseek-v4.1-flash-1017': { id: 'deepseek/deepseek-v4.1-flash-1017', name: 'V4.1 1017', limit: { context: 1000000, output: 384000 } },
      },
    },
  })
  const hit = lookupModels(dated, ['deepseek/deepseek-v4.1-flash'], {
    route: 'goat-163',
    baseURL: 'https://api.commandcode.ai/provider/v1',
  })
  assert.equal(hit.matched.length, 1)
  assert.equal(hit.matched[0].providerId, 'commandcode')
  assert.equal(hit.matched[0].maxOutput, 384000)
})

test('no endpoint, no route, no identifiable vendor -> unmatched, never a guess', () => {
  const blind = lookupModels(index, ['deepseek/deepseek-v4.1-flash'])
  assert.equal(blind.matched.length, 0)
  assert.equal(blind.unmatched.length, 1)
})
