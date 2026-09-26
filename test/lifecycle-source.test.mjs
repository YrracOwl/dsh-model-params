import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

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
  // NEITHER settings transport may appear in exports.inject: cordis treats every
  // inject name as a REQUIRED gate, so declaring the optional transport leaves the
  // plugin permanently pending and fails Web boot. The official pi-ai scope is
  // awaited in apply as ctx.inject([...], cb) instead.
  assert.match(client, /exports\.inject = \['slots', 'remote', 'remote\.settings'\]/)
  assert.match(client, /function resolveSettingsScopeFrom\(ctx, namespace\)/)
  assert.match(client, /ctx\.inject\(\['settingsScope'\], registerCard\)/)
  assert.match(client, /ctx\.inject\(\['configForms'\], \(sctx\) => \{ if \(!cardRegistered\) registerCard\(sctx\) \}\)/)
  assert.doesNotMatch(client, /exports\.inject = \[[^\]]*settingsScope/)
  assert.doesNotMatch(client, /exports\.inject = \[[^\]]*configForms/)
  assert.doesNotMatch(client, /ctx\.settingsScope\.bind/)
  assert.doesNotMatch(client, /'connection'|ctx\.get\('connection'\)/)
})

test('client registers the official provider-card slot keyed to the pi-ai namespace', () => {
  // 卡片必须在设置传输的子上下文上注册（sctx.slots），见 client.js 的 registerCard。
  assert.match(client, /sctx\.slots\.inject\('settings\.models\.provider-card'/)
  assert.match(client, /key: PI_NS/)
  assert.match(client, /PI_NS = 'llm-pi-ai'/)
  assert.match(client, /path: \['providers', route, 'models'\]/)
  assert.match(client, /expectedRevision/)
})

test('client writes only on an explicit apply and defaults to fill-missing', () => {
  assert.match(client, /overwrite/)
  assert.match(client, /仅补缺失/)
  assert.match(client, /api\.settings\.mutate/)
  assert.match(client, /setOpen\(false\)/)
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

test('shared proxy control is visible at the top and forwarded to Host', () => {
  assert.match(client, /使用公共 models\.dev 请求代理/)
  assert.match(client, /proxyState\.enabled/)
  assert.match(client, /refreshProxy\(\(value\) => value \+ 1\)/)
  assert.match(client, /proxy=/)
  assert.match(host, /searchParams\.get\('proxy'\)/)
  assert.match(host, /new ProxyAgent\(proxy\)/)
})

test('README discloses scope and the apply-to-this-provider boundary', () => {
  assert.match(readme, /models\.dev/)
  assert.match(readme, /llm-pi-ai/)
  assert.match(readme, /覆盖已有值|fill-missing|仅补缺失/)
})

test('pure helpers stay importable without DSH peers', () => {
  assert.doesNotMatch(modelsdev + host, /from ['"]@deepseek-ai\/(?:dsh-|cordis)/)
})

// ── additive seat: the `settings.section` page ──────────────────────────────
//
// 0.1.7-rc.2 declares the root-scope LIST slot `settings.section` ("one settings
// page per list entry") beside the official Models page this package extends.
// That seat is host-version dependent, so it is ADDITIVE and must never gate the
// plugin: it is awaited through the same NON-GATING `ctx.inject(['slots'], …)`
// shape as the provider card, whose callback returns the registration disposer.
// This package owns no bundle row, so there is no `plugins.row.config` occupant:
// its card component IS the `settings.models.provider-card` occupant's
// `ModelParamsExtension`, and the section page renders that same component —
// one settings UI, one transport, one read/write path.

// The bundle is a browser artifact, but it needs no DOM to LOAD: constructing it
// only calls __ModuleLoader__.load and require('react'). Evaluating it here gives
// the real exports and the real card component, which is stronger than matching
// source text. `reactHooks` lets a test hand the bundle a real-enough React;
// without it the fake has no hooks, which is all the registration tests need.
function loadClientPlugin(reactHooks = {}) {
  let spec = null
  const sandbox = {
    // `apply` probes for `document`; the style helpers and the panel's
    // Escape/outside-click listeners are the only other DOM touchpoints.
    document: {
      querySelector: () => undefined,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
    },
    window: { __ModuleLoader__: { load(captured) { spec = captured } } },
    // Present so a click that re-opens the panel reaches the (stubbed) lookup
    // path instead of throwing inside an unhandled promise.
    setTimeout: () => 0,
    clearTimeout: () => {},
    AbortController: class { constructor() { this.signal = {} } abort() {} },
    fetch: async () => ({ json: async () => ({ ok: true, matched: [], unmatched: [] }) }),
  }
  vm.createContext(sandbox)
  vm.runInContext(client, sandbox, { filename: 'lib/client.js' })
  assert.ok(spec && typeof spec.factory === 'function', 'bundle must call window.__ModuleLoader__.load({ factory })')
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    ...reactHooks,
  }
  const plugin = spec.factory((id) => {
    if (id === 'react') return react
    throw new Error('unexpected require(' + id + ')')
  })
  return { plugin, react }
}

// One host shape: which optional services and which Slots are declared. `inject`
// fires only when every requested name is provided, exactly like cordis.
// `disposals` records the Slot-registration disposers the plugin actually
// released (by slot name), so a test can prove the registration joined the
// plugin's disposal path: register → slots.inject return → disposeSlots → the
// disposer apply returns.
function makeCtx({ services = [], slots = [], value } = {}) {
  const registered = []
  const disposals = []
  const scope = {
    getSnapshot: () => ({ status: 'ready', writable: true, base: {}, user: {}, revision: 1, value: value || {} }),
    subscribe: () => () => {},
  }
  const ctx = {
    get(name) {
      if (name === 'settingsScope' && services.includes('settingsScope')) return { bind: () => scope }
      if (name === 'configForms' && services.includes('configForms')) return { get: () => scope }
      return undefined
    },
    inject(names, cb) {
      const list = Array.isArray(names) ? names : [names]
      if (list.every((name) => name === 'slots' || services.includes(name))) cb(ctx)
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    slots: {
      inject(slot, cb) {
        if (!slots.includes(slot)) return () => {}
        const dispose = cb()
        return typeof dispose === 'function' ? dispose : () => {}
      },
      register(options, component) {
        registered.push({ options, component })
        return () => { disposals.push(options.name) }
      },
    },
  }
  return { ctx, registered, disposals }
}

test('additive settings.section seat carries the exact nav identity', () => {
  assert.match(client, /const registerSettingsSection = \(sctx\) => \{/)
  assert.match(client, /sctx\.slots\.inject\('settings\.section', \(\) => sctx\.slots\.register\(\{/)
  assert.match(client, /name: 'settings\.section'/)
  assert.match(client, /id: 'yotk-model-params'/)
  assert.match(client, /order: 63/)
  // label is a THUNK: the shell re-reads it on every projection instead of
  // caching registrant-localized text
  assert.match(client, /label: \(\) => 'YOTK · Model Params'/)
  // registered from inside the non-gating slots wait, and the disposer the
  // callback returns joins the plugin's disposal path. The wiring assertion is
  // anchored to a real statement so a commented-out / disabled call fails here
  // instead of merely matching inside a comment.
  assert.match(client, /^\s*ctx\.inject\(\['slots'\], registerSettingsSection\)$/m)
  assert.match(client, /disposeSlots\.push\(sctx\.slots\.inject\('settings\.section'/)
  // the seat declares exactly { id, order, label } — no invented contract keys
  assert.doesNotMatch(client, /name: 'settings\.section',\s*\n\s*locale:/)
})

test('settings.section fires without any settings transport and never gates', () => {
  const { plugin } = loadClientPlugin()
  // A host that declares the section seat but NO settings transport at all: the
  // seat registration must still fire (non-gating), exactly like the provider
  // card's wait.
  const { ctx, registered, disposals } = makeCtx({
    services: [],
    slots: ['settings.section', 'settings.models.provider-card'],
  })
  const dispose = plugin.apply(ctx)
  const section = registered.find((item) => item.options.name === 'settings.section')
  assert.ok(section, 'the settings.section occupant must register where the seat is declared')
  assert.deepEqual(Object.keys(section.options).sort(), ['id', 'label', 'name', 'order'])
  assert.equal(section.options.id, 'yotk-model-params')
  assert.equal(section.options.order, 63)
  assert.equal(typeof section.options.label, 'function')
  assert.equal(section.options.label(), 'YOTK · Model Params')
  // the registration is owned by the plugin: the callback's returned disposer is
  // what the plugin's own disposer releases
  assert.deepEqual(disposals, [], 'nothing is released before the plugin is disposed')
  dispose()
  assert.deepEqual(disposals.slice().sort(), ['settings.section'])

  // A host that does not declare the seat: nothing registers there and apply
  // still succeeds, so the seat can never gate activation.
  const absent = makeCtx({ services: [], slots: [] })
  assert.equal(typeof plugin.apply(absent.ctx), 'function')
  assert.deepEqual(absent.registered, [])
})

test('the settings.section page renders the same card component as the provider-card seat', () => {
  const { plugin } = loadClientPlugin()
  const { ctx, registered } = makeCtx({
    services: ['configForms'],
    slots: ['settings.section', 'settings.models.provider-card'],
  })
  plugin.apply(ctx)
  const section = registered.find((item) => item.options.name === 'settings.section')
  const card = registered.find((item) => item.options.name === 'settings.models.provider-card')
  assert.ok(section, 'expected a settings.section occupant')
  assert.ok(card, 'expected a settings.models.provider-card occupant')
  assert.equal(card.options.key, 'llm-pi-ai')

  // The section owner shares `close` and nothing else ...
  const sectionPage = section.component({ close: () => {} })
  const cardPage = card.component({ provider: { entry: { provider: 'acme', settingsNs: 'llm-pi-ai' } } })
  // ... and it renders the SAME component the provider-card seat renders: one
  // settings UI, one read path, one write path.
  assert.equal(typeof sectionPage.type, 'function')
  assert.equal(sectionPage.type, cardPage.type)
  assert.equal(sectionPage.props.scope, cardPage.props.scope)
  // neither `close` nor the host-owned optional `form` prop is consumed. The
  // only extra prop is the disclosure default: this page holds ONE card, so its
  // panel must start expanded (pinned behaviourally below).
  assert.deepEqual(Object.keys(sectionPage.props).sort(), ['api', 'defaultOpen', 'scope'])
  const passedForm = section.component({ close: () => {}, form: { state: {}, mutate() {} } })
  assert.equal(passedForm.type, sectionPage.type)
  assert.equal(passedForm.props.scope, sectionPage.props.scope)
})

// ── the panel default: expanded where the card renders alone ────────────────
//
// Two seats render this ONE card: the Models-page provider card, which shows one
// control per provider, and the additive `settings.section` page, which holds it
// alone. The panel must start expanded on the latter while the trigger button
// keeps folding it back. The hooks below are a minimal host that keeps one state
// slot per `useState` call across render passes, so `onClick` followed by a
// re-render IS the user's click: no source-text matching is involved.
function createHookHost() {
  let state = []
  let cursor = 0
  return {
    hooks: {
      useState(initial) {
        const index = cursor++
        if (!(index in state)) state[index] = initial
        const set = (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }
        return [state[index], set]
      },
      useEffect() { cursor++; return undefined },
      useRef(value) { cursor++; return { current: value } },
    },
    // a FRESH mount: React would own new state slots for a new card instance
    mount() { state = []; cursor = 0 },
    // one render pass: hook slots are addressed from 0 again, state survives
    render(component, props) { cursor = 0; return component(props) },
  }
}

const PROVIDER = { entry: { provider: 'acme', settingsNs: 'llm-pi-ai', displayName: 'Acme' }, provider: 'acme' }
const PI_AI_VALUE = { providers: { acme: { models: [{ id: 'acme-1' }] } } }

test('the panel starts expanded on the single-card seat and the trigger still collapses it', () => {
  const host = createHookHost()
  const { plugin } = loadClientPlugin(host.hooks)
  const { ctx, registered } = makeCtx({
    services: ['configForms'],
    slots: ['settings.section', 'settings.models.provider-card'],
    value: PI_AI_VALUE,
  })
  plugin.apply(ctx)
  const section = registered.find((item) => item.options.name === 'settings.section')
  const element = section.component({ close: () => {} })
  // the seat asks for the expanded panel ...
  assert.equal(element.props.defaultOpen, true, 'settings.section must ask for an expanded card')

  // The section owner supplies NO provider (`SettingsSectionOwnerProps` is
  // `{ close }` alone), so this page resolves its OWN provider from the one
  // settings transport this package already reads: the llm-pi-ai snapshot, whose
  // `providers` dict IS keyed by provider route. With the one route configured in
  // PI_AI_VALUE (`acme`) the seat's own props render the real card — not null,
  // which is what this guard pinned before the page learned to resolve itself.
  host.mount()
  const standalone = host.render(element.type, element.props)
  assert.ok(standalone, 'the section page must render content without a provider from the host')
  assert.equal(standalone.props.className, 'dpmWrap')
  assert.equal(standalone.children[0].props['aria-expanded'], true, 'the self-resolved page must start expanded')
  assert.ok(standalone.children[1], 'the panel must be rendered while expanded')

  // The disclosure below stays exercised through the SAME component with a
  // provider supplied, exactly as the Models-page seat supplies it.
  const sectionProps = { ...element.props, provider: PROVIDER }
  host.mount()
  const expanded = host.render(element.type, sectionProps)
  assert.equal(expanded.props.className, 'dpmWrap')
  // ... and the first render shows it open: the trigger reports the expanded
  // panel and the panel itself is rendered
  assert.equal(expanded.children[0].props['aria-expanded'], true, 'settings.section must start expanded')
  assert.ok(expanded.children[1], 'the panel must be rendered while expanded')

  // the manual toggle still folds it back up
  expanded.children[0].props.onClick()
  const collapsed = host.render(element.type, sectionProps)
  assert.equal(collapsed.children[0].props['aria-expanded'], false, 'the trigger must collapse the panel')
  assert.equal(collapsed.children[1], false, 'the collapsed panel must not render')

  // ... and opens it again, so the disclosure stays a two-way toggle
  collapsed.children[0].props.onClick()
  const reopened = host.render(element.type, sectionProps)
  assert.equal(reopened.children[0].props['aria-expanded'], true)
  assert.ok(reopened.children[1])

  // the Models-page provider card is untouched: it renders one control per
  // provider beside the others, which is why its panel default stayed collapsed
  const { ctx: cardCtx, registered: cardRegistered } = makeCtx({
    services: ['configForms'],
    slots: ['settings.models.provider-card'],
    value: PI_AI_VALUE,
  })
  loadClientPlugin(host.hooks).plugin.apply(cardCtx)
  const cardElement = cardRegistered[0].component({ provider: PROVIDER })
  assert.equal(cardElement.props.defaultOpen, undefined, 'the Models-page seat asks for nothing')
  host.mount()
  const cardCollapsed = host.render(cardElement.type, cardElement.props)
  assert.equal(cardCollapsed.children[0].props['aria-expanded'], false)
  assert.equal(cardCollapsed.children[1], false)
})

// ── the page seat resolves a REAL provider, or explains itself ──────────────
//
// The page must never be blank and must never invent a route. A ready namespace
// with no provider, and a host with no settings transport at all, are different
// facts and each renders its own honest hint; a namespace declaring several
// providers offers exactly those routes, because a page holding ONE card would
// otherwise silently address whichever one happened to be declared first.

test('the section page explains an empty or unavailable namespace instead of rendering blank', () => {
  const host = createHookHost()
  const { plugin } = loadClientPlugin(host.hooks)
  // Ready llm-pi-ai section, no provider configured yet: content, not null.
  const empty = makeCtx({ services: ['configForms'], slots: ['settings.section'], value: {} })
  plugin.apply(empty.ctx)
  const emptySection = empty.registered.find((item) => item.options.name === 'settings.section')
  host.mount()
  const emptyElement = emptySection.component({ close: () => {} })
  const rendered = host.render(emptyElement.type, emptyElement.props)
  assert.ok(rendered, 'an empty namespace must still render content, never null')
  assert.equal(rendered.props.className, 'dpmWrap')
  assert.match(String(rendered.children[0].children), /还没有已配置的 provider/)

  // The seat exists but no settings transport does: nothing can be read or
  // written, and the page says so instead of showing an empty surface.
  const bare = makeCtx({ services: [], slots: ['settings.section'] })
  plugin.apply(bare.ctx)
  const bareSection = bare.registered.find((item) => item.options.name === 'settings.section')
  const bareElement = bareSection.component({ close: () => {} })
  host.mount()
  const unavailable = host.render(bareElement.type, bareElement.props)
  assert.ok(unavailable, 'a host without a settings transport must still render the explanation')
  assert.match(String(unavailable.children[0].children), /设置传输不可用/)
})

test('the section page offers every real llm-pi-ai route and addresses the chosen one', () => {
  const host = createHookHost()
  const { plugin } = loadClientPlugin(host.hooks)
  const value = {
    providers: {
      acme: { displayName: 'Acme', models: [{ id: 'acme-1' }] },
      beta: { models: [{ id: 'beta-1' }] },
    },
  }
  const { ctx, registered } = makeCtx({ services: ['configForms'], slots: ['settings.section'], value })
  plugin.apply(ctx)
  const section = registered.find((item) => item.options.name === 'settings.section')
  host.mount()
  const element = section.component({ close: () => {} })
  const rendered = host.render(element.type, element.props)
  // `close` alone arrived: the routes came from the namespace's own snapshot
  assert.deepEqual(Object.keys(element.props).sort(), ['api', 'defaultOpen', 'scope'])
  // and a lookup answer is stamped with the route it was requested for, so a
  // response that lands after the page moved on cannot be shown beside another
  // provider's models
  assert.match(client, /rawResult\.route === route/)
  assert.match(client, /setRawResult\(\{ route: targetRoute,/)
  const panel = rendered.children[1]
  const chooser = panel.children.find((child) => child && child.props && child.props.className === 'dpmRoute')
  assert.ok(chooser, 'a namespace with several providers must let the page choose one')
  const select = chooser.children[1]
  // the fake createElement hands an array child through unflattened; real React
  // renders it as the option list
  const options = select.children.flat()
  assert.deepEqual(options.map((option) => option.props.value), ['acme', 'beta'])
  // the profile's own displayName labels it, and the bare route is the fallback
  assert.deepEqual(options.map((option) => option.children[0]), ['Acme', 'beta'])
  assert.equal(select.props.value, 'acme')
  assert.match(String(panel.children[0].children[0]), /^Acme · /)

  // switching addresses the other real route through the SAME card and transport
  select.props.onChange({ target: { value: 'beta' } })
  const switched = host.render(element.type, element.props)
  const switchedPanel = switched.children[1]
  assert.match(String(switchedPanel.children[0].children[0]), /^beta · /)
  const switchedSelect = switchedPanel.children.find((child) => child && child.props && child.props.className === 'dpmRoute')
  assert.equal(switchedSelect.children[1].props.value, 'beta')
})
