// dsh-model-params — client half (official __ModuleLoader__ web bundle)
//
// Renders a compact "models.dev 参数" affordance inside every official
// llm-pi-ai provider card on the Models settings page
// (settings.models.provider-card, keyed by the pi-ai settings namespace).
// The same card is ALSO registered on the root-scope `settings.section` list
// seat (id `yotk-model-params`), which makes it a first-class settings page of
// its own on hosts that declare that seat. That seat's owner share is
// `{ close }` alone, so the page is handed no provider: it resolves one of the
// routes the llm-pi-ai namespace itself declares, from the same scope and
// never through a second read path.
// Either way it reads the current provider profile from the official llm-pi-ai
// Settings scope, asks the Host for the matching models.dev records, previews the
// proposed context / max-output / reasoning-effort values per model, and — only
// on an explicit "应用" click — writes the merged models array back through the
// revision-aware official Settings API. Default policy fills missing parameters
// only; "覆盖已有值" also replaces differing ones.
// The plugin never auto-writes, never touches other providers/namespaces,
// and never sends credentials anywhere.

window.__ModuleLoader__.load({
  id: 'dsh-model-params',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const e = React.createElement

    const PI_NS = 'llm-pi-ai'
    const API = '/api/model-params/lookup'

    // ── settings-scope portability (DSH 0.1.5 ↔ 0.1.7-rc.1) ──────────────────
    //
    // This plugin owns no settings namespace: it extends the OFFICIAL pi-ai
    // Models page and writes that provider's own `llm-pi-ai` section. The two
    // supported hosts expose the same scope CONTRACT under different names:
    //
    //   ≤ 0.1.5  settingsScope.bind({ namespace })  → SettingsScope<T>
    //   ≥ 0.1.7  configForms.get(entryId)           → ConfigForm<T>
    //
    // Both return getSnapshot()/subscribe()/set()/unset()/mutate() over the same
    // { status, value, base, user, revision, writable, mode } snapshot, so the
    // resolved object is used unchanged by the provider card. On 0.1.7-rc.1 a
    // form's namespace IS the profile entry id, and the pi-ai LLM entry is
    // mounted as `llm-pi-ai`, so the same key resolves on either host.
    // `ctx.get` (never a direct property read) keeps the lookup safe when only
    // one service is mounted: an uninjected property read throws.
    function resolveSettingsScopeFrom(ctx, namespace) {
      const binder = ctx.get('settingsScope')
      if (binder && typeof binder.bind === 'function') return binder.bind({ namespace })
      const forms = ctx.get('configForms')
      if (forms && typeof forms.get === 'function') return forms.get(namespace)
      return undefined
    }
    const FETCH_TIMEOUT_MS = 20000
    const CSS_ID = 'dsh-model-params/style'
    const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
     const PROXY_DEFAULT = 'http://127.0.0.1:7890'
     const proxyState = { enabled: false, url: PROXY_DEFAULT, listeners: new Set() }
     const notifyProxy = () => proxyState.listeners.forEach((listener) => listener())

    const CSS = [
      '.dpmRow{display:flex;align-items:center;gap:8px;margin:2px 0}',
      '.dpmButton{appearance:none;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 12px;font-size:12px;line-height:1.5;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}',
      '.dpmButton:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed);color:var(--dsw-alias-label-primary)}',
      '.dpmButton:disabled{opacity:.5;cursor:default}',
      '.dpmWrap{position:relative;display:inline-flex}',
      '.dpmPanel{position:absolute;z-index:30;left:0;top:calc(100% + 6px);width:min(480px,calc(100vw - 48px));max-height:min(420px,calc(100vh - 120px));overflow:auto;display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5}',
      '.dpmPanel h4{margin:0;font-size:13px}',
       '.dpmProxy{display:flex;flex-direction:column;gap:6px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}',
       '.dpmProxy label{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);cursor:pointer}',
       '.dpmProxy input[type=text]{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px}',
      '.dpmRoute{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}',
      '.dpmRoute select{font:inherit;font-size:11px;max-width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:3px 6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.dpmHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px;line-height:1.5}',
      '.dpmErr{color:var(--dsw-alias-state-error-primary);margin:0;font-size:11px;word-break:break-all}',
      '.dpmList{display:flex;flex-direction:column;gap:6px}',
      '.dpmItem{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px;background:var(--dsw-alias-bg-layer-3)}',
      '.dpmItemHead{display:flex;align-items:baseline;gap:8px}.dpmItemId{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dpmItemTag{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.dpmFields{display:flex;flex-direction:column;gap:2px;margin-top:4px;color:var(--dsw-alias-label-secondary)}',
      '.dpmFieldRow{display:flex;gap:8px;flex-wrap:wrap}.dpmFieldRow b{color:var(--dsw-alias-label-secondary);font-weight:600}',
      '.dpmNoMatch{color:var(--dsw-alias-state-warn-primary)}',
      '.dpmFoot{display:flex;align-items:center;gap:10px;justify-content:flex-end;border-top:1px solid var(--dsw-alias-border-l2);margin-top:2px;padding-top:8px}',
      '.dpmFoot label{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);margin-right:auto;cursor:pointer}',
      '.dpmSaved{color:var(--dsw-alias-state-success-primary);margin:0;font-size:11px}',
      '.dpmPrimary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);border-color:transparent}',
    ].join('')

    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_ID) + ']')) return
      const tag = document.createElement('style')
      tag.dataset.pluginCss = CSS_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }
    function removeStyles() {
      if (typeof document === 'undefined') return
      const tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_ID) + ']')
      if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
    }

    const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined
    const intersectLevels = (values) => (values || []).filter((value) => LEVELS.includes(value))

    // ── the section page's own provider (the `settings.section` seat) ─────────
    //
    // The root-scope section seat's owner share is `{ close }` ALONE
    // (SettingsSectionOwnerProps), so that page is handed NO provider while its
    // Models-page sibling receives one per card. It therefore resolves its
    // provider from the ONE settings transport this package already reads: the
    // `llm-pi-ai` section itself, whose `providers` dict IS keyed by provider
    // route (PiAiProviderProfile). Every route this page addresses is one the
    // namespace really declares — never a synthesized id, never a second read or
    // write path — and the profile supplies the real display name when it has one.
    function piAiValue(snapshot) {
      return snapshot && snapshot.status === 'ready' && snapshot.value && typeof snapshot.value === 'object' ? snapshot.value : undefined
    }
    function piAiRoutes(snapshot) {
      const value = piAiValue(snapshot)
      const providers = value && value.providers && typeof value.providers === 'object' && !Array.isArray(value.providers) ? value.providers : undefined
      return providers ? Object.keys(providers).filter((route) => typeof route === 'string' && route.length > 0) : []
    }
    function piAiProfile(snapshot, route) {
      const value = piAiValue(snapshot)
      const profile = value && value.providers && typeof value.providers === 'object' ? value.providers[route] : undefined
      return profile && typeof profile === 'object' ? profile : undefined
    }
    function piAiModels(snapshot, route) {
      const profile = piAiProfile(snapshot, route)
      return profile && Array.isArray(profile.models) ? profile.models : []
    }
    function piAiDisplayName(snapshot, route) {
      const profile = piAiProfile(snapshot, route)
      return (profile && clean(profile.displayName)) || route
    }
    // What the page says when it has no card to draw. A namespace still loading, a
    // namespace this host does not serve, and a namespace with no provider
    // configured are three different facts, and none may look like a blank page.
    function sectionPageHint(snapshot, scope) {
      if (!scope) return '设置传输不可用：本机未挂载 settingsScope / configForms，无法读写 llm-pi-ai 配置。'
      const status = snapshot && snapshot.status
      if (status === 'loading') return '正在读取 llm-pi-ai 设置…'
      if (status !== 'ready') return '当前 Host 未提供 llm-pi-ai 设置，无法读写模型参数。'
      return 'llm-pi-ai 命名空间下还没有已配置的 provider；请先在 设置 → 模型 中添加一个自定义 provider。'
    }

    function paramLine(label, value) {
      if (value === undefined || value === null || value === '') return null
      return e('span', { key: label }, label + ': ' + value)
    }

    function ModelParamsExtension(props) {
      const row = props.provider
      const entry = row && row.entry && typeof row.entry === 'object' ? row.entry : row
      // The provider the Models page hands this card through the seat's own owner
      // props. The section seat hands NONE (`{ close }` is its whole owner share),
      // so there this card IS the page and picks its own provider from the routes
      // the namespace declares — see the resolvers above.
      const seatRoute = entry && (entry.provider || row && row.provider)
      const api = props.api
      const scope = props.scope
      // The panel starts COLLAPSED on the Models-page provider card, which renders
      // one control per provider beside the others; it starts EXPANDED wherever the
      // card is the whole page (`settings.section` passes `defaultOpen: true`), so
      // the single-card seat opens with its content already visible. The trigger
      // button below keeps folding it either way.
      const [open, setOpen] = React.useState(props.defaultOpen === true)
      // Which real route this card addresses on the page seat. Ignored while a
      // provider arrives from the host, because a provider CARD is bound to the
      // row it extends and must never follow a module-level selection.
      const [picked, setPicked] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState('')
      const [saved, setSaved] = React.useState('')
      const [overwrite, setOverwrite] = React.useState(false)
       const [, refreshProxy] = React.useState(0)
       React.useEffect(() => {
         const rerender = () => refreshProxy((value) => value + 1)
         proxyState.listeners.add(rerender)
         return () => proxyState.listeners.delete(rerender)
       }, [])
       const [, refreshScope] = React.useState(0)
       // The page's only reason to re-render beyond its own clicks: the namespace
       // may still be loading at first paint, and a provider added in 设置 → 模型
       // must appear here without a reload. ONE subscription on the same transport,
       // disposed with the card.
       React.useEffect(() => {
         if (!scope || typeof scope.subscribe !== 'function') return undefined
         const unsubscribe = scope.subscribe(() => refreshScope((value) => value + 1))
         return () => { if (typeof unsubscribe === 'function') unsubscribe() }
       }, [scope])
      // A lookup answer is stamped with the route it was requested for: this card
      // can change its addressed provider (the page seat's chooser, or the
      // namespace dropping the picked route) while a request is in flight, and the
      // previous provider's matches must never be previewed beside this one's
      // models.
      const [rawResult, setRawResult] = React.useState(null) // { route, matched: [], unmatched: [] }
      const ref = React.useRef(null)

      React.useEffect(() => {
        if (!open) return undefined
        const outside = (event) => { if (!ref.current || !ref.current.contains(event.target)) setOpen(false) }
        const key = (event) => { if (event.key === 'Escape') setOpen(false) }
        document.addEventListener('mousedown', outside)
        document.addEventListener('keydown', key)
        return () => {
          document.removeEventListener('mousedown', outside)
          document.removeEventListener('keydown', key)
        }
      }, [open])

      const snap = scope && typeof scope.getSnapshot === 'function' ? scope.getSnapshot() : { status: 'unavailable' }
      // Two seats, ONE card. Where the host supplies a provider, this is the
      // per-provider control it always was. Where none arrives (the
      // `settings.section` page), this card is the page: it addresses the first
      // route the llm-pi-ai namespace declares, or the one the user picked from the
      // namespace's real route list.
      const sectionSeat = !seatRoute
      const routes = sectionSeat ? piAiRoutes(snap) : []
      const route = sectionSeat ? (routes.includes(picked) ? picked : routes[0]) : seatRoute
      const settingsNs = sectionSeat ? PI_NS : entry && entry.settingsNs
      if (!route || settingsNs !== PI_NS) {
        // A provider CARD whose namespace is not ours renders nothing (the seat
        // dispatches by settingsNs, so this is defensive). The page seat owns the
        // whole surface instead, so it always explains what it cannot draw rather
        // than showing an empty page.
        if (!sectionSeat) return null
        return e('div', { className: 'dpmWrap' }, e('p', { className: 'dpmHint' }, sectionPageHint(snap, scope)))
      }

      const models = piAiModels(snap, route)
      // Only this route's answer is this route's preview.
      const result = rawResult && rawResult.route === route ? rawResult : null
      const writable = snap.status === 'ready' && snap.writable === true && !!api && !!api.settings

      async function load(routeOverride) {
        const targetRoute = routeOverride || route
        const targetModels = routeOverride ? piAiModels(snap, routeOverride) : models
        if (!targetModels.length || busy) return
        setBusy(true)
        setFailed('')
        setSaved('')
        setRawResult(null)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        try {
          const ids = targetModels.map((model) => model.id).filter(Boolean)
          const query = '?ids=' + encodeURIComponent(ids.join(',')) + (proxyState.enabled ? '&proxy=' + encodeURIComponent((proxyState.url.trim() || PROXY_DEFAULT)) : '')
           const response = await fetch(API + query, { cache: 'no-store', signal: controller.signal })
          const data = await response.json()
          if (!data || data.ok !== true) throw new Error((data && data.error) || 'lookup failed')
          setRawResult({ route: targetRoute, matched: data.matched || [], unmatched: data.unmatched || [] })
        } catch (error) {
          setFailed(String((error && error.name === 'AbortError') ? '请求超时' : (error && error.message) || error))
        } finally {
          clearTimeout(timer)
          setBusy(false)
        }
      }

      function mergeModel(existing, found, index) {
        const next = { ...existing }
        const from = result.matched.find((match) => match.requested === existing.id) || found
        if (!from) return null
        const apply = (key, foundValue) => {
          if (foundValue === undefined) return
          if (next[key] === undefined || next[key] === null) next[key] = foundValue
          else if (overwrite && next[key] !== foundValue) next[key] = foundValue
        }
        apply('contextWindow', from.context)
        apply('maxTokens', from.maxOutput)
        if (!next.name) next.name = from.name
        const offered = intersectLevels(from.efforts)
        if (offered.length) {
          const current = next.reasoningEfforts && typeof next.reasoningEfforts === 'object' && !Array.isArray(next.reasoningEfforts) ? next.reasoningEfforts : {}
          const merged = { ...current }
          let changed = false
          for (const level of offered) {
            if (merged[level] === undefined || overwrite) {
              if (merged[level] !== level) changed = true
              merged[level] = level
            }
          }
          if (overwrite) {
            for (const key of Object.keys(merged)) {
              if (!offered.includes(key) && LEVELS.includes(key)) delete merged[key]
            }
            changed = true
          }
          if (changed || Object.keys(merged).length !== Object.keys(current).length) next.reasoningEfforts = merged
          if (Object.keys(next.reasoningEfforts || {}).length === 0 && !current) delete next.reasoningEfforts
        }
        void index
        return next
      }

      async function applyAll() {
        if (!writable || busy || !result) return
        const byRequested = new Map(result.matched.map((match) => [match.requested, match]))
        const nextModels = models.map((model) => {
          const found = byRequested.get(model.id)
          return found ? (mergeModel(model, found) || model) : model
        })
        const touched = nextModels.some((model, index) => model !== models[index])
        if (!touched) { setSaved('没有可写入的变更（仅补缺失且无缺失）。'); setOpen(false); return }
        setBusy(true)
        setFailed('')
        setSaved('')
        try {
          const payload = { ns: PI_NS, ops: [{ op: 'set', path: ['providers', route, 'models'], value: nextModels }], ...(snap.revision === undefined ? {} : { expectedRevision: snap.revision }) }
          const response = await api.settings.mutate(payload)
          if (!(response && response.result && response.result.ok)) {
            const detail = response && response.result && response.result.error && response.result.error.message
            throw new Error(detail || '设置被拒绝')
          }
          setSaved('已写入 provider "' + route + '" 的模型参数。')
           setOpen(false)
          setRawResult(null)
        } catch (error) {
          setFailed(String((error && error.message) || error))
        } finally {
          setBusy(false)
        }
      }

      // The Models page joins the official directory, so its `displayName` is the
      // richest one. The page seat has only the namespace's own profile, which may
      // declare one; otherwise the route itself is the honest label.
      const displayName = (entry && entry.displayName) || piAiDisplayName(snap, route)
      const hasModels = models.length > 0
      const summary = result && result.matched ? result.matched.length + '/' + models.length + ' 匹配' : ''

      return e('div', { className: 'dpmWrap', ref },
        e('button', { type: 'button', className: 'dpmButton', disabled: !hasModels, 'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: () => { setOpen((v) => !v); if (!open) load() } },
          busy ? '查询中…' : ('models.dev 参数' + (summary ? ' · ' + summary : ''))),
        open && e('div', { className: 'dpmPanel', role: 'dialog', 'aria-label': displayName + ' models.dev 参数' },
          e('h4', null, displayName + ' · models.dev 官方参数'),
          // A namespace may declare SEVERAL llm-pi-ai providers. This page holds ONE
          // card, so it offers the namespace's real routes instead of silently
          // addressing whichever one is declared first; a single-route namespace gets
          // no chooser at all, because there is nothing to choose.
          routes.length > 1 && e('label', { className: 'dpmRoute' }, 'provider',
            e('select', {
              value: route,
              'aria-label': '选择要处理的 llm-pi-ai provider',
              onChange: (event) => {
                const next = event.target.value
                setPicked(next)
                setRawResult(null)
                setSaved('')
                setFailed('')
                void load(next)
              },
            }, routes.map((item) => e('option', { key: item, value: item }, piAiDisplayName(snap, item)))),
          ),
           e('div', { className: 'dpmProxy' },
             e('label', null,
               e('input', { type: 'checkbox', checked: proxyState.enabled, onChange: (ev) => { proxyState.enabled = ev.target.checked; notifyProxy() } }),
               '使用公共 models.dev 请求代理',
             ),
             e('input', { type: 'text', value: proxyState.url, disabled: !proxyState.enabled, placeholder: PROXY_DEFAULT, 'aria-label': '公共 models.dev 请求代理地址', onChange: (ev) => { proxyState.url = ev.target.value; notifyProxy() } }),
             e('p', { className: 'dpmHint' }, '该地址对所有 provider 共用，仅代理 models.dev 参数查询，不改变 LLM provider 地址。'),
           ),
          failed && e('p', { className: 'dpmErr', role: 'alert' }, failed),
          saved && e('p', { className: 'dpmSaved', role: 'status' }, saved),
          !hasModels && e('p', { className: 'dpmHint' }, '该 provider 的 models 列表为空；先在官方页添加模型条目后再获取参数。'),
          result && e('div', { className: 'dpmList' }, result.matched.length === 0 && result.unmatched.length === 0
            ? e('p', { className: 'dpmHint' }, '没有可匹配的模型。')
            : models.map((model) => {
              const found = result.matched.find((match) => match.requested === model.id)
              const currentEfforts = model.reasoningEfforts && typeof model.reasoningEfforts === 'object' && !Array.isArray(model.reasoningEfforts)
                ? Object.keys(model.reasoningEfforts).join('/')
                : undefined
              const propose = found ? mergeModel(model, found) : null
              const change = propose && (
                (model.contextWindow === undefined && propose.contextWindow !== undefined) ||
                (model.maxTokens === undefined && propose.maxTokens !== undefined) ||
                (model.contextWindow !== undefined && propose.contextWindow !== undefined && overwrite && model.contextWindow !== propose.contextWindow) ||
                (model.maxTokens !== undefined && propose.maxTokens !== undefined && overwrite && model.maxTokens !== propose.maxTokens) ||
                (propose.reasoningEfforts && JSON.stringify(propose.reasoningEfforts) !== JSON.stringify(model.reasoningEfforts))
              )
              return e('div', { key: model.id, className: 'dpmItem' },
                e('div', { className: 'dpmItemHead' },
                  e('span', { className: 'dpmItemId' }, model.id),
                  found
                    ? e('span', { className: 'dpmItemTag' }, found.providerName + ' · ' + found.name + (change ? ' · 将更新' : ' · 完整'))
                    : e('span', { className: 'dpmItemTag dpmNoMatch' }, 'models.dev 未收录'),
                ),
                found && e('div', { className: 'dpmFields' },
                  e('div', { className: 'dpmFieldRow' }, paramLine('上下文', found.context), paramLine('max 输出', found.maxOutput), paramLine('推理档位', found.efforts && found.efforts.length ? found.efforts.join('/') : undefined)),
                  e('div', { className: 'dpmFieldRow' },
                    paramLine('当前上下文', model.contextWindow),
                    paramLine('当前 max', model.maxTokens),
                    currentEfforts && paramLine('当前推理', currentEfforts),
                  ),
                ),
              )
            })),
          result && e('div', { className: 'dpmFoot' },
            e('label', null, e('input', { type: 'checkbox', checked: overwrite, onChange: (ev) => setOverwrite(ev.target.checked) }), '覆盖已有值（默认仅补缺失）'),
            e('button', { type: 'button', className: 'dpmButton dpmPrimary', disabled: !writable || busy, onClick: applyAll }, '应用并写入该 provider'),
          ),
        ),
      )
    }

    function apply(ctx) {
      ensureStyles()
      ctx.effect(() => () => removeStyles(), 'dsh-model-params: styles')
      // Fine-grained remote settings through @deepseek-ai/dsh-api-remotes
      // (ctx.remote); the legacy connection API no longer exists on rc.1.
      const remote = ctx.get('remote')
      const api = remote && remote.settings
        ? { settings: { mutate: (payload) => remote.settings.mutate(payload.ns, payload.ops, payload.expectedRevision).then((result) => ({ result })) } }
        : undefined
      // Version-portable scope on the official pi-ai namespace. Both transport
      // names are awaited WITHOUT gating activation, and whichever this host
      // mounts resolves; see resolveSettingsScopeFrom.
      let scope
      let cardRegistered = false
      // Slot-registration disposers, released from apply's own disposer on stop /
      // update / HMR so no seat entry outlives the plugin.
      const disposeSlots = []
      // The provider card MUST register from inside a context that has the
      // settings transport, i.e. from the `ctx.inject([...], cb)` callback and on
      // the CHILD context it hands us. Registering
      // `settings.models.provider-card` from the bare apply context puts the
      // entry where the Models page's ledger never sees it, so the extension
      // never renders even though `register` returned normally. (dshmarket, an
      // out-of-repo bundle that does render its card, uses this nested shape.)
      const registerCard = (sctx) => {
        if (cardRegistered) return
        const resolved = resolveSettingsScopeFrom(sctx, PI_NS)
        if (resolved === undefined) return
        scope = resolved
        cardRegistered = true
        disposeSlots.push(sctx.slots.inject('settings.models.provider-card', () => sctx.slots.register(
          { name: 'settings.models.provider-card', key: PI_NS },
          (props) => e(ModelParamsExtension, { ...props, api, scope }),
        )))
      }
      // The first wait fires only when settingsScope exists; the second covers a
      // host that renamed the transport, and its guard keeps the card from
      // registering twice when both names exist.
      ctx.inject(['settingsScope'], registerCard)
      ctx.inject(['configForms'], (sctx) => { if (!cardRegistered) registerCard(sctx) })

      // ── additive seat: the `settings.section` page ─────────────────────────
      //
      // 0.1.7-rc.2 also declares the root-scope LIST slot `settings.section`
      // ("one settings page per list entry"), which puts this card one click deep
      // inside 设置 as a first-class page of its own. It is purely ADDITIVE: the
      // provider-card extension above stays the Models-page affordance, and both
      // render the SAME `ModelParamsExtension` through the SAME resolved transport
      // — no second settings UI and no second read/write path. This package owns
      // no bundle row, so there is no `plugins.row.config` occupant to mirror:
      // its card is the official Models-page extension.
      //
      // That seat's owner share is `{ close }` alone, so this page is handed NO
      // provider. It addresses one of the routes the llm-pi-ai namespace itself
      // declares — read from the SAME resolved scope, so no second read path and no
      // synthesized route — and explains a loading, unavailable or provider-less
      // namespace instead of rendering a blank page. The page passes no `provider`
      // prop, which is exactly how the card knows it is the whole page.
      //
      // The wait on `slots` is NON-GATING (the seat is host-version dependent: a
      // host that does not declare it simply never fires the inner `slots.inject`,
      // so this registration can never gate the plugin), the callback RETURNS the
      // registration disposer, and that disposer is pushed onto disposeSlots so
      // the entry is owned by the registering fiber and released with the rest on
      // stop / update / HMR.
      const registerSettingsSection = (sctx) => {
        disposeSlots.push(sctx.slots.inject('settings.section', () => sctx.slots.register({
          name: 'settings.section',
          id: 'yotk-model-params',
          order: 63,
          label: () => 'YOTK · Model Params',
        }, function ModelParamsSettingsSection() {
          // The seat owner shares `close` and nothing else; this card needs
          // neither it nor the host-owned optional `form` prop, because values
          // keep flowing through the one resolved transport — so the page is the
          // same card component the provider-card seat renders, with the panel
          // expanded: one card alone on the page. The trigger button still folds
          // it back up.
          return e(ModelParamsExtension, { api, scope, defaultOpen: true })
        })))
      }
      ctx.inject(['slots'], registerSettingsSection)

      return () => { for (const dispose of disposeSlots) { try { dispose() } catch (_) {} } }
    }

    exports.name = 'dsh-model-params'
    // 'settingsScope' and 'configForms' are alternatives, not both-required:
    // cordis resolves each inject name as its own gate, so activation succeeds on
    // whichever settings transport the host mounts (0.1.5 vs 0.1.7-rc.1). The
    // dotted remote names stay declared — dropping them fails the loader fiber.
    exports.inject = ['slots', 'remote', 'remote.settings']
    exports.apply = apply
    return module.exports
  },
})
