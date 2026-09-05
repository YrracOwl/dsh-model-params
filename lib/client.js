// dsh-model-params — client half (official __ModuleLoader__ web bundle)
//
// Renders a compact "models.dev 参数" affordance inside every official
// llm-pi-ai provider card on the Models settings page
// (settings.models.provider-card, keyed by the pi-ai settings namespace).
// It reads the current provider profile from the official llm-pi-ai Settings
// scope, asks the Host for the matching models.dev records, previews the
// proposed context / max-output / reasoning-effort values per model, and —
// only on an explicit "应用" click — writes the merged models array back
// through the revision-aware official Settings API. Default policy fills
// missing parameters only; "覆盖已有值" also replaces differing ones.
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

    function paramLine(label, value) {
      if (value === undefined || value === null || value === '') return null
      return e('span', { key: label }, label + ': ' + value)
    }

    function ModelParamsExtension(props) {
      const row = props.provider
      const entry = row && row.entry && typeof row.entry === 'object' ? row.entry : row
      const route = entry && (entry.provider || row && row.provider)
      const settingsNs = entry && entry.settingsNs
      const api = props.api
      const scope = props.scope
      const [open, setOpen] = React.useState(false)
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
      const [result, setResult] = React.useState(null) // { matched: [], unmatched: [] }
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

      if (!route || settingsNs !== PI_NS) return null

      const snap = scope && typeof scope.getSnapshot === 'function' ? scope.getSnapshot() : { status: 'unavailable' }
      const value = snap.status === 'ready' && snap.value && typeof snap.value === 'object' ? snap.value : {}
      const profile = value.providers && value.providers[route] && typeof value.providers[route] === 'object' ? value.providers[route] : null
      const models = Array.isArray(profile && profile.models) ? profile.models : []
      const writable = snap.status === 'ready' && snap.writable === true && !!api && !!api.settings

      async function load() {
        if (!models.length || busy) return
        setBusy(true)
        setFailed('')
        setSaved('')
        setResult(null)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        try {
          const ids = models.map((model) => model.id).filter(Boolean)
          const query = '?ids=' + encodeURIComponent(ids.join(',')) + (proxyState.enabled ? '&proxy=' + encodeURIComponent((proxyState.url.trim() || PROXY_DEFAULT)) : '')
           const response = await fetch(API + query, { cache: 'no-store', signal: controller.signal })
          const data = await response.json()
          if (!data || data.ok !== true) throw new Error((data && data.error) || 'lookup failed')
          setResult({ matched: data.matched || [], unmatched: data.unmatched || [] })
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
          setResult(null)
        } catch (error) {
          setFailed(String((error && error.message) || error))
        } finally {
          setBusy(false)
        }
      }

      const displayName = entry && entry.displayName ? entry.displayName : route
      const hasModels = models.length > 0
      const summary = result && result.matched ? result.matched.length + '/' + models.length + ' 匹配' : ''

      return e('div', { className: 'dpmWrap', ref },
        e('button', { type: 'button', className: 'dpmButton', disabled: !hasModels, 'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: () => { setOpen((v) => !v); if (!open) load() } },
          busy ? '查询中…' : ('models.dev 参数' + (summary ? ' · ' + summary : ''))),
        open && e('div', { className: 'dpmPanel', role: 'dialog', 'aria-label': displayName + ' models.dev 参数' },
          e('h4', null, displayName + ' · models.dev 官方参数'),
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
      const scope = ctx.settingsScope.bind({ namespace: PI_NS })
      return ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register(
        { name: 'settings.models.provider-card', key: PI_NS },
        (props) => e(ModelParamsExtension, { ...props, api, scope }),
      ))
    }

    exports.name = 'dsh-model-params'
    exports.inject = ['slots', 'settingsScope', 'remote', 'remote.settings']
    exports.apply = apply
    return module.exports
  },
})
