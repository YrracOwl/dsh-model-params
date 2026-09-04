import test from 'node:test'
import assert from 'node:assert/strict'
import { intersectEfforts, lookupModels, parseModelsDevCatalog } from '../lib/modelsdev.js'

const FIXTURE = {
  providers: {
    deepseek: {
      id: 'deepseek', name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', limit: { context: 1000000, output: 384000 }, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', limit: { context: 1000000 } },
        { id: 'embedding-x', name: 'Embedding X', limit: { context: 8192 } },
      ],
    },
    zhipuai: {
      id: 'zhipuai', name: 'Zhipu AI',
      models: [
        { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', limit: { context: 1048576, output: 128000 }, reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'xhigh'] }] },
      ],
    },
    noisy: { id: 'noisy', name: 'Noisy', models: [{ id: 'empty-model' }, 'not-an-object'] },
  },
}

test('parses context, output and effort metadata defensively', () => {
  const index = parseModelsDevCatalog(FIXTURE)
  assert.equal(index.size, 4)
  const flash = index.get('deepseek-v4-flash')[0]
  assert.equal(flash.context, 1000000)
  assert.equal(flash.maxOutput, 384000)
  assert.deepEqual(flash.efforts, ['low', 'high', 'max'])
  // Records with no metadata at all are skipped (embedding-x stays, empty-model drops)
  assert.ok(!index.has('empty-model'))
  assert.equal(index.get('deepseek-v4-pro')[0].maxOutput, undefined)
})

test('matches prefixed ids by exact id or by segment after the last slash', () => {
  const index = parseModelsDevCatalog(FIXTURE)
  const result = lookupModels(index, ['deepseek/deepseek-v4-flash', 'z-ai/glm-5.3-flash', 'zhipuai/glm-5.3-flash', 'unknown/zzz'])
  assert.deepEqual(result.unmatched, ['unknown/zzz'])
  assert.equal(result.matched.length, 3)
  const flash = result.matched.find((entry) => entry.requested === 'deepseek/deepseek-v4-flash')
  assert.equal(flash.providerId, 'deepseek')
  assert.equal(flash.modelId, 'deepseek-v4-flash')
})

test('provider hint prefers the matching catalog provider when ids collide', () => {
  const index = parseModelsDevCatalog(FIXTURE)
  const hints = { 'glm-5.3-flash': 'zhipuai' }
  const base = index.get('glm-5.3-flash') ? 'glm-5.3-flash' : 'glm-5.3-flash'
  const result = lookupModels(index, [base], (id) => hints[id])
  assert.equal(result.matched[0].providerId, 'zhipuai')
})

test('effort values are restricted to the pi-ai thinking-level space', () => {
  assert.deepEqual(intersectEfforts(['low', 'bogus', 'max', 'medium']), ['low', 'max', 'medium'])
  assert.deepEqual(intersectEfforts(undefined), [])
})

test('malformed documents degrade to an empty index', () => {
  assert.equal(parseModelsDevCatalog(null).size, 0)
  assert.equal(parseModelsDevCatalog({ providers: [] }).size, 0)
  assert.equal(lookupModels(new Map(), []).unmatched.length, 0)
})
