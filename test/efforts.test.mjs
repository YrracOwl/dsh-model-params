// Behavioural tests for the reasoning-effort logic, against the OFFICIAL contract.
//
// The logic lives inside lib/client.js because a client bundle can only require
// platform seeds — no relative imports. Rather than assert on source text (which
// would pass for a broken implementation that merely mentions the right words),
// this suite extracts the marked region and RUNS it in a VM. The assertions are
// the real rules from @deepseek-ai/dsh-llm-pi-ai's `resolveModelReasoning` and
// dsh-client-ui-settings-models's `ModelReasoningEfforts`:
//
//   • keys are pi-ai thinking levels
//   • values are WIRE strings (or null for `off` only)
//   • `{}` is refused, and so is a map with no level beyond `off`

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Extract the marked reasoning-efforts region and evaluate it. */
function loadEfforts() {
  const start = source.indexOf('// #region reasoning-efforts')
  const end = source.indexOf('// #endregion reasoning-efforts')
  assert.ok(start > 0 && end > start, 'the reasoning-efforts region markers must exist')
  assert.match(source, /const THINKING_LEVELS = \['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'\]/)
  const body = source.slice(source.indexOf('\n', start) + 1, end)
  const context = vm.createContext({})
  vm.runInContext(body, context, { filename: 'lib/client.js#reasoning-efforts' })
  return vm.runInContext(
    '({ THINKING_LEVELS, INITIAL_LEVELS, defaultEffortWire, acceptsEffortWire, readEfforts, validateEfforts, intersectLevels, mergeEfforts, describeEfforts })',
    context,
  )
}

const api = loadEfforts()

// `hostReasoningLevels` sits OUTSIDE the region (it is a service adapter, not the
// rules), so it is exercised here by calling the bundle's own copy through the
// same extraction trick: pull the function source and run it.
function loadHostLevels() {
  const start = source.indexOf('function hostReasoningLevels(')
  assert.ok(start > 0, 'hostReasoningLevels must exist')
  // Walk braces to the matching close so the extraction survives edits above.
  let depth = 0
  let index = source.indexOf('{', start)
  const open = index
  for (; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  const body = source.slice(start, index + 1)
  const context = vm.createContext({})
  vm.runInContext(body, context, { filename: 'lib/client.js#hostReasoningLevels' })
  return (schema, namespace) => vm.runInContext('hostReasoningLevels', context)(schema, namespace)
}

// Values crossing the VM boundary carry that realm's Array/Object prototypes, so
// `deepStrictEqual` would compare prototypes rather than content. Normalise to
// plain JSON before every structural assertion; the behaviour under test is the
// content, not which realm allocated it.
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

test('the level space is pi-ai\'s, in escalation order', () => {
  assert.deepEqual(plain(api.THINKING_LEVELS), ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  // The official editor seeds exactly these four when its switch is turned on.
  assert.deepEqual(plain(api.INITIAL_LEVELS), ['off', 'low', 'medium', 'high'])
  for (const level of api.INITIAL_LEVELS) assert.ok(api.THINKING_LEVELS.includes(level))
})

test('only `off` sends nothing; every other level defaults to its own name', () => {
  // Official `defaultValue`: `level === 'off' ? null : level`.
  assert.equal(api.defaultEffortWire('off'), null)
  for (const level of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    assert.equal(api.defaultEffortWire(level), level)
  }
})

test('acceptedValue mirrors the Host: non-empty string, or null for off only', () => {
  assert.equal(api.acceptsEffortWire('off', null), true)
  assert.equal(api.acceptsEffortWire('low', 'low'), true)
  assert.equal(api.acceptsEffortWire('low', 'medium'), true, 'a differing wire value is legal')
  // Refusals the Host raises:
  assert.equal(api.acceptsEffortWire('off', 'off'), true, 'a string is a legal wire even for off')
  assert.equal(api.acceptsEffortWire('low', null), false, 'only off may be null')
  assert.equal(api.acceptsEffortWire('low', ''), false, 'empty string is refused')
  assert.equal(api.acceptsEffortWire('low', 3), false)
})

test('readEfforts distinguishes absent, false, null and a real map', () => {
  assert.equal(api.readEfforts({}), undefined, 'absent field -> undefined (host keeps catalog capability)')
  assert.equal(api.readEfforts({ reasoningEfforts: false }), undefined, 'false -> undefined (non-reasoning)')
  assert.deepEqual(plain(api.readEfforts({ reasoningEfforts: null })), [], 'null -> no rows')
  assert.deepEqual(
    plain(api.readEfforts({ reasoningEfforts: { low: 'medium', off: null } })),
    [['low', 'medium'], ['off', null]],
    'rows keep their stored order',
  )
  // `readEfforts` must never throw on a hostile shape.
  assert.equal(api.readEfforts({ reasoningEfforts: [] }), undefined)
  assert.equal(api.readEfforts({ reasoningEfforts: 'high' }), undefined)
})

test('validateEfforts returns the official refusal keys', () => {
  assert.equal(api.validateEfforts({}), undefined)
  assert.equal(api.validateEfforts({ reasoningEfforts: false }), undefined)
  assert.equal(api.validateEfforts({ reasoningEfforts: { low: 'low' } }), undefined)
  // A non-off level with a null wire is refused.
  assert.equal(api.validateEfforts({ reasoningEfforts: { low: null } }), 'modelReasoningValueRequired')
  // A map with only `off` offers no thinking level.
  assert.equal(api.validateEfforts({ reasoningEfforts: { off: null } }), 'modelReasoningNeedsLevel')
  assert.equal(api.validateEfforts({ reasoningEfforts: {} }), 'modelReasoningNeedsLevel')
})

test('intersectLevels keeps catalog order, drops non-levels and duplicates', () => {
  assert.deepEqual(plain(api.intersectLevels(['low', 'medium', 'high'])), ['low', 'medium', 'high'])
  // models.dev reports `none` where pi-ai says `off`; it must not leak through.
  assert.deepEqual(plain(api.intersectLevels(['none', 'low', 'bogus', 'max'])), ['low', 'max'])
  assert.deepEqual(plain(api.intersectLevels(['high', 'low', 'high'])), ['high', 'low'], 'vendor order wins')
  assert.deepEqual(plain(api.intersectLevels(undefined)), [])
})

test('merging writes WIRE values, with off as null — never `value = level` for off', () => {
  const merged = plain(api.mergeEfforts({ id: 'm' }, ['off', 'low', 'high'], false))
  assert.deepEqual(merged, { off: null, low: 'low', high: 'high' })
  // The regression this replaces: `off` used to be written as the string 'off'.
  assert.equal(merged.off, null)
  assert.notEqual(merged.off, 'off')
})

test('a hand-tuned wire value survives unless overwrite is set', () => {
  // A gateway that maps `low` onto the wire value "medium" is the reason this
  // field exists at all; filling must not clobber it.
  const model = { id: 'm', reasoningEfforts: { low: 'medium', high: 'high' } }
  assert.equal(api.mergeEfforts(model, ['low', 'high'], false), undefined, 'nothing missing -> no write')
  // Adding a missing level keeps the tuned row verbatim.
  assert.deepEqual(
    plain(api.mergeEfforts(model, ['low', 'high', 'xhigh'], false)),
    { low: 'medium', high: 'high', xhigh: 'xhigh' },
  )
  // overwrite replaces only what cannot be accepted; it does not normalise a
  // legal wire value back to the level name.
  assert.equal(api.mergeEfforts(model, ['low', 'high'], true), undefined)
})

test('overwrite drops levels the catalog no longer offers, but not foreign keys', () => {
  const model = { id: 'm', reasoningEfforts: { low: 'low', max: 'max', future_level: 'x' } }
  const merged = plain(api.mergeEfforts(model, ['low', 'high'], true))
  assert.deepEqual(merged, { low: 'low', high: 'high', future_level: 'x' }, 'max dropped, future_level kept')
})

test('a deliberately non-reasoning model is never widened', () => {
  // `reasoningEfforts: false` is the host's way of saying "this model does not
  // reason"; filling it from the catalog would contradict the person.
  assert.equal(api.mergeEfforts({ id: 'm', reasoningEfforts: false }, ['low', 'high'], false), undefined)
  assert.equal(api.mergeEfforts({ id: 'm', reasoningEfforts: false }, ['low', 'high'], true), undefined)
})

test('never emits a map the Host would refuse', () => {
  // An empty catalog offers nothing to write.
  assert.equal(api.mergeEfforts({ id: 'm' }, [], false), undefined)
  assert.equal(api.mergeEfforts({ id: 'm' }, ['bogus'], false), undefined)
  // `off` alone would be refused by the Host (`modelReasoningNeedsLevel`), so the
  // plugin declines to write rather than breaking the whole route.
  assert.equal(api.mergeEfforts({ id: 'm' }, ['off'], false), undefined)
  // Every map it DOES return must pass the Host's own validation.
  for (const offered of [['low'], ['off', 'low'], ['low', 'medium', 'high'], ['minimal', 'max']]) {
    const merged = api.mergeEfforts({ id: 'm' }, offered, false)
    assert.notEqual(merged, undefined, 'expected a write for ' + offered.join('/'))
    assert.equal(
      api.validateEfforts({ reasoningEfforts: merged }),
      undefined,
      'emitted map must be host-valid for ' + offered.join('/'),
    )
  }
})

test('describeEfforts surfaces a mismapped wire instead of hiding it', () => {
  assert.equal(api.describeEfforts({}), undefined)
  assert.equal(api.describeEfforts({ reasoningEfforts: null }), '未声明')
  assert.equal(api.describeEfforts({ reasoningEfforts: { off: null, low: 'low' } }), 'off=∅ · low')
  assert.equal(
    api.describeEfforts({ reasoningEfforts: { low: 'medium', high: 'high' } }),
    'low=medium · high',
    'a differing wire value must be visible',
  )
})

// ── host-declared level space ────────────────────────────────────────────────
//
// The official Models page does not hard-code its level list: it walks the pi-ai
// namespace schema to `providers.<probe>.models.0.reasoningEfforts` and reads the
// union member's dict keys (`reasoningLevelChoices`). `hostReasoningLevels`
// reproduces that walk against `ctx.settingsSchema`, so this plugin writes the
// vocabulary the installed host actually declares rather than a snapshot of it.
const hostReasoningLevels = loadHostLevels()

/** A stand-in for the settings-owned schema service, shaped like Schemastery. */
function fakeSchema(levels) {
  const dictNode = {
    type: 'dict',
    sKey: { list: levels.map((value) => ({ value })) },
  }
  return {
    rehydrate: (serialized) => ({ __root: serialized }),
    nodeAtPath: (root, path) => {
      // Only the documented probe path answers; anything else is absent, exactly
      // as the real service answers for a route that does not exist.
      const joined = path.join('/')
      assert.equal(root.__root, 'serialized-envelope', 'the walk must start from the namespace schema envelope')
      if (joined !== 'providers/\u0000probe/models/0/reasoningEfforts') return undefined
      return { type: 'union', list: [{ type: 'string' }, dictNode] }
    },
  }
}

test('the level space is read from the host schema, like the official page does', () => {
  const schema = fakeSchema(['off', 'low', 'medium', 'high', 'max'])
  const namespace = { ns: 'llm-pi-ai', schema: 'serialized-envelope' }
  assert.deepEqual(plain(hostReasoningLevels(schema, namespace)), ['off', 'low', 'medium', 'high', 'max'])
})

test('a host that cannot answer degrades instead of throwing', () => {
  // No schema service / no namespace view: the caller falls back to THINKING_LEVELS.
  assert.equal(hostReasoningLevels(undefined, { schema: 'x' }), undefined)
  assert.equal(hostReasoningLevels(fakeSchema(['off']), undefined), undefined)
  // A service that lacks the schema API (an older host) must not be probed.
  assert.equal(hostReasoningLevels({}, { schema: 'x' }), undefined)
  // A namespace with no serialized schema (not yet described) yields nothing.
  assert.equal(hostReasoningLevels(fakeSchema(['off']), { ns: 'llm-pi-ai' }), undefined)
  // A schema walk that throws is contained.
  const exploding = {
    rehydrate: () => ({}),
    nodeAtPath: () => { throw new Error('boom') },
  }
  assert.equal(hostReasoningLevels(exploding, { schema: 'x' }), undefined)
})

test('an empty host declaration falls back rather than emptying the level space', () => {
  const schema = fakeSchema([])
  assert.equal(hostReasoningLevels(schema, { schema: 'serialized-envelope' }), undefined)
})

test('the host space, when present, actually constrains the write', () => {
  // A host that declares only these three must not receive a `max` row.
  const space = ['off', 'low', 'high']
  const merged = plain(api.mergeEfforts({ id: 'm' }, ['low', 'high', 'max'], false, space))
  assert.deepEqual(merged, { low: 'low', high: 'high' }, 'max is outside the host space')
  // A model that already declares every offered level needs no write. Its
  // out-of-space `max` row is NOT pruned: pruning only removes levels the host
  // space CONTAINS but the catalog no longer offers, so a key outside the space
  // is treated as a forward-compatible extension and left alone (in practice the
  // space equals pi-ai's fixed list, since the host reads it from the same
  // schema — this is the defensive branch, not a configuration anyone can build).
  const complete = { id: 'm', reasoningEfforts: { low: 'low', high: 'high', max: 'max' } }
  assert.equal(
    api.mergeEfforts(complete, ['low', 'high'], false, space),
    undefined,
    'nothing missing and no overwrite -> no write',
  )
  assert.equal(
    api.mergeEfforts(complete, ['low', 'high'], true, space),
    undefined,
    'overwrite still cannot prune a key outside the host space',
  )
  // A level the space CONTAINS but the catalog does not offer is pruned under
  // overwrite; `off` is in the space here and the catalog omitted it, so it goes.
  const inSpace = { id: 'm', reasoningEfforts: { off: null, low: 'low', high: 'high' } }
  assert.deepEqual(
    plain(api.mergeEfforts(inSpace, ['low', 'high'], true, space)),
    { low: 'low', high: 'high' },
    'an in-space level the catalog dropped is pruned by overwrite',
  )
  // The out-of-space key is untouched by the same call.
  const foreign = { id: 'm', reasoningEfforts: { low: 'low', max: 'max' } }
  assert.deepEqual(
    plain(api.mergeEfforts(foreign, ['low', 'high'], true, space)),
    { low: 'low', max: 'max', high: 'high' },
    'a key outside the host space is an extension and survives',
  )
})
