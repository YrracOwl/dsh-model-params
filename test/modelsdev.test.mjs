import test from 'node:test'
import assert from 'node:assert/strict'
import { intersectEfforts, lookupModels, parseModelsDevCatalog } from '../lib/modelsdev.js'

// Mirrors the REAL models.dev/api.json shape: flat provider root, models as
// an id-keyed object, effort values possibly including "none" toggles.
const FIXTURE = {
  deepseek: {
    id: 'deepseek', name: 'DeepSeek',
    models: {
      'deepseek-v4-flash': { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', limit: { context: 1000000, output: 384000 }, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] },
      'deepseek-v4-pro': { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', limit: { context: 1000000 }, reasoning_options: [{ type: 'toggle' }] },
      'embedding-x': { id: 'embedding-x', name: 'Embedding X', limit: { context: 8192 } },
    },
  },
  zai: {
    id: 'zai', name: 'Z.ai',
    models: {
      'glm-5.3-flash': { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', limit: { context: 1048576, output: 128000 }, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'xhigh'] }] },
    },
  },
  openai: {
    id: 'openai', name: 'OpenAI',
    models: {
      'gpt-5.6-sol': { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', limit: { context: 1050000, output: 128000 }, reasoning_options: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] }] },
    },
  },
  noisy: { id: 'noisy', name: 'Noisy', models: { 'empty-model': { id: 'empty-model' } } },
  // Gateway mirrors that key their catalog copies with vendor prefixes.
  tokengo: {
    id: 'tokengo', name: 'TokenGo',
    models: {
      'deepseek/deepseek-v4-flash': { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', limit: { context: 1000000, output: 384000 } },
      'z-ai/glm-5.3-flash': { id: 'z-ai/glm-5.3-flash', name: 'GLM-5.3-Flash', limit: { context: 1000000, output: 131072 } },
    },
  },
}

test('parses the real flat catalog shape defensively', () => {
  const index = parseModelsDevCatalog(FIXTURE)
  assert.equal(index.size, 7)
  const flash = index.get('deepseek-v4-flash')[0]
  assert.equal(flash.providerId, 'deepseek')
  assert.equal(flash.context, 1000000)
  assert.equal(flash.maxOutput, 384000)
  assert.deepEqual(flash.efforts, ['low', 'high', 'max'])
  assert.equal(index.get('deepseek-v4-pro')[0].efforts, undefined)
  assert.ok(!index.has('empty-model'))
})

test('matches prefixed and bare ids; provider hint leads on collisions', () => {
  const index = parseModelsDevCatalog(FIXTURE)
  const result = lookupModels(index, ['deepseek/deepseek-v4-flash', 'z-ai/glm-5.3-flash', 'unknown/zzz'])
  assert.deepEqual(result.unmatched, ['unknown/zzz'])
  assert.equal(result.matched.length, 2)
  const flash = result.matched.find((entry) => entry.requested === 'deepseek/deepseek-v4-flash')
  assert.equal(flash.providerId, 'deepseek')
  assert.equal(flash.hinted, true)
  const glm = result.matched.find((entry) => entry.requested === 'z-ai/glm-5.3-flash')
  assert.equal(glm.providerId, 'zai')
})

test('near match inside the hinted provider covers versioned ids', () => {
  const index = parseModelsDevCatalog(FIXTURE)
  const result = lookupModels(index, ['deepseek-v4-flash-0731'])
  assert.equal(result.unmatched.length, 0)
  assert.equal(result.matched[0].providerId, 'deepseek')
  assert.equal(result.matched[0].modelId, 'deepseek-v4-flash')
})

test('official vendor record wins over a prefixed gateway mirror', () => {
  const index = parseModelsDevCatalog(FIXTURE)
  const result = lookupModels(index, ['deepseek/deepseek-v4-flash', 'z-ai/glm-5.3-flash'])
  assert.equal(result.matched[0].providerId, 'deepseek')
  assert.equal(result.matched[1].providerId, 'zai')
})

test('catalog provider order breaks exact-id ties when no hint applies', () => {
  const index = parseModelsDevCatalog(FIXTURE)
  const result = lookupModels(index, ['gpt-5.6-sol'])
  assert.equal(result.matched[0].providerId, 'openai')
})

test('effort values are restricted to the pi-ai thinking-level space', () => {
  assert.deepEqual(intersectEfforts(['none', 'low', 'medium', 'high', 'xhigh', 'max']), ['low', 'medium', 'high', 'xhigh', 'max'])
  assert.deepEqual(intersectEfforts(['low', 'bogus', 'max']), ['low', 'max'])
  assert.deepEqual(intersectEfforts(undefined), [])
})

test('malformed documents degrade to an empty index', () => {
  assert.equal(parseModelsDevCatalog(null).size, 0)
  assert.equal(parseModelsDevCatalog({ providers: [] }).size, 0)
  assert.equal(parseModelsDevCatalog({ providers: { x: { models: [] } } }).size, 0)
  assert.equal(lookupModels(new Map(), []).unmatched.length, 0)
})
