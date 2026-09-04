import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const host = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const modelsdev = fs.readFileSync(new URL('../lib/modelsdev.js', import.meta.url), 'utf8')
const patch = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')

test('bundle patch inserts only the model-params row', () => {
  const effective = patch.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
  assert.match(effective, /id: model-params/)
  assert.doesNotMatch(effective, /disable:|replace:|agent preset/i)
})

test('host exposes one fenced lookup route and never writes settings', () => {
  assert.match(host, /\/api\/model-params\/lookup/)
  assert.equal((host.match(/ws\.register\(/g) || []).length, 1)
  assert.doesNotMatch(host, /settings\.mutate|settings\.register/)
  assert.match(host, /originAllowed\(req\)/)
  assert.match(host, /hostAllowed\(req\)/)
  assert.match(host, /models\.dev\/api\.json/)
})

test('client follows the ModuleLoader factory contract and injects dotted remotes', () => {
  assert.match(client, /factory: \(require\) => \{\s*const module = \{ exports: \{\} \}/)
  assert.match(client, /return module\.exports/)
  assert.match(client, /exports\.inject = \['slots', 'settingsScope', 'remote', 'remote\.settings'\]/)
  assert.doesNotMatch(client, /'connection'|ctx\.get\('connection'\)/)
})

test('client registers the official provider-card slot keyed to the pi-ai namespace', () => {
  assert.match(client, /settings\.models\.provider-card/)
  assert.match(client, /key: PI_NS/)
  assert.match(client, /PI_NS = 'llm-pi-ai'/)
  assert.match(client, /path: \['providers', route, 'models'\]/)
  assert.match(client, /expectedRevision/)
})

test('client writes only on an explicit apply and defaults to fill-missing', () => {
  assert.match(client, /overwrite/)
  assert.match(client, /仅补缺失/)
  assert.match(client, /api\.settings\.mutate/)
  assert.match(client, /contextWindow/)
  assert.match(client, /maxTokens/)
  assert.match(client, /reasoningEfforts/)
  assert.match(client, /intersectLevels/)
})

test('no extreme stacking or body mounting; styles are lifecycle-owned', () => {
  assert.doesNotMatch(client, /214748/)
  assert.doesNotMatch(client, /document\.body\.appendChild/)
  assert.match(client, /ctx\.effect\(\(\) => \(\) => removeStyles\(\)/)
  assert.match(client, /data-plugin-css/)
})

test('lookup endpoint usage and timeout/cleanup are present', () => {
  assert.match(client, /\/api\/model-params\/lookup/)
  assert.match(client, /AbortController/)
  assert.match(client, /clearTimeout\(timer\)/)
})

test('README discloses scope and the apply-to-this-provider boundary', () => {
  assert.match(readme, /models\.dev/)
  assert.match(readme, /llm-pi-ai/)
  assert.match(readme, /覆盖已有值|fill-missing|仅补缺失/)
})

test('pure helpers stay importable without DSH peers', () => {
  assert.doesNotMatch(modelsdev + host, /from ['"]@deepseek-ai\/(?:dsh-|cordis)/)
})
