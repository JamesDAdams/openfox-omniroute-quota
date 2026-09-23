import type { PluginContext, PluginRegistry, QuotaMetric, QuotaProvider, QuotaSource } from './contract.js'
import { getOmniRouteSettings, normalizeBaseUrl, type OmniRoutePluginSettings } from '../settings.js'

const CACHE_TTL_MS = 30_000

type QuotaWindow = 'hour' | 'day' | 'week' | 'month'

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function normalizeWindow(value: unknown): QuotaWindow {
  const v = typeof value === 'string' ? value.toLowerCase() : ''
  if (v.includes('hour') || v.includes('session') || v.includes('rolling')) return 'hour'
  if (v.includes('day') || v.includes('daily')) return 'day'
  if (v.includes('week') || v.includes('weekly')) return 'week'
  return 'month'
}

function capitalize(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatModelName(id: string): string {
  return id
    .replace(/(\d+)-(\d+)/g, '$1.$2')
    .replace(/_/g, ' ')
    .split('-')
    .map((w) => capitalize(w))
    .join(' ')
}

function formatSectionName(
  providerSlug?: string,
  accountName?: string,
  planName?: string,
  connIndex = 1,
): string {
  const p = (providerSlug || '').toLowerCase()
  const plan = (planName || '').toLowerCase()

  let baseName = ''
  if (p === 'github' || plan.includes('copilot')) {
    baseName = 'GitHub Copilot Business'
  } else if (p === 'opencode-go' || p === 'opencode' || plan.includes('opencode')) {
    baseName = 'OpenCode Go'
  } else if (p === 'antigravity' || plan === 'pro') {
    baseName = 'Google Antigravity'
  } else if (p === 'codex' || plan.includes('codex') || plan.includes('k12')) {
    baseName = 'OpenAI Codex'
  } else {
    baseName = planName || (providerSlug ? capitalize(providerSlug) : 'OmniRoute Provider')
  }

  if (accountName && accountName !== 'main' && accountName !== baseName && !baseName.includes(accountName)) {
    return `${baseName} (${accountName})`
  }
  if (connIndex > 1) {
    return `${baseName} ${connIndex}`
  }
  return baseName
}

function getBaseProviderName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

export function mergeQuotaSources(sources: QuotaSource[]): QuotaSource[] {
  const groups = new Map<string, QuotaSource[]>()
  for (const source of sources) {
    const base = getBaseProviderName(source.name)
    const list = groups.get(base) ?? []
    list.push(source)
    groups.set(base, list)
  }

  const merged: QuotaSource[] = []

  for (const [baseName, groupSources] of groups.entries()) {
    if (groupSources.length === 1) {
      merged.push(groupSources[0]!)
      continue
    }

    const mergedMetricsMap = new Map<
      string,
      { metric: QuotaMetric; count: number }
    >()

    for (const src of groupSources) {
      for (const m of src.metrics) {
        const key = `${m.kind}:${m.label}:${m.model ?? ''}:${m.kind === 'windowed' ? m.window : ''}`
        const existing = mergedMetricsMap.get(key)
        if (!existing) {
          mergedMetricsMap.set(key, {
            metric: { ...m },
            count: 1,
          })
        } else {
          if (m.kind === 'windowed' && existing.metric.kind === 'windowed') {
            existing.metric.used += m.used
            existing.metric.limit += m.limit
            if (m.resetsAt) {
              existing.metric.resetsAt = m.resetsAt
            }
          } else if (m.kind === 'token-balance' && existing.metric.kind === 'token-balance') {
            existing.metric.total += m.total
            existing.metric.remaining += m.remaining
          }
          existing.count += 1
        }
      }
    }

    const mergedSource: QuotaSource = {
      id: `omniroute-merged-${baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: `${baseName} (${groupSources.length} accounts)`,
      description: `Combined usage across ${groupSources.length} subscriptions`,
      metrics: Array.from(mergedMetricsMap.values()).map((v) => v.metric),
    }
    merged.push(mergedSource)
  }

  return merged
}

function parseProvidersRaw(raw: unknown): Array<{ connectionId: string; name: string; provider: string }> {
  if (Array.isArray(raw)) {
    return raw
      .filter((p) => p && typeof p === 'object' && p.connectionId)
      .map((p) => ({
        connectionId: String(p.connectionId),
        name: p.name ? String(p.name) : '',
        provider: p.provider ? String(p.provider) : '',
      }))
  }
  if (typeof raw === 'string') {
    const list: Array<{ connectionId: string; name: string; provider: string }> = []
    const lines = raw.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('[') || trimmed.startsWith('connectionId')) continue
      const parts = trimmed.split(',')
      if (parts.length >= 4) {
        const connectionId = parts[0]?.trim()
        const name = parts[1]?.trim()
        const provider = parts[3]?.trim()
        if (connectionId) {
          list.push({ connectionId, name: name || '', provider: provider || '' })
        }
      }
    }
    return list
  }
  return []
}

export interface OmniRouteQuotaManagerOptions {
  baseUrl?: string
  apiKey?: string
  mergeSubscriptions?: boolean
  displayedQuotas?: import('../settings.js').DisplayedQuotasOption
  context?: PluginContext
  getSettings?: () => OmniRoutePluginSettings
  fetcher?: typeof fetch
  now?: () => number
}

const GLOBAL_QUOTA_KEY = Symbol.for('openfox.quotaManager')
const PENDING_PROVIDERS_KEY = Symbol.for('openfox.pendingQuotaProviders')

export class OmniRouteQuotaManager {
  private explicitBaseUrl?: string
  private explicitApiKey?: string
  private explicitMergeSubscriptions?: boolean
  private explicitDisplayedQuotas?: import('../settings.js').DisplayedQuotasOption
  private readonly context?: PluginContext
  private readonly getSettingsFn?: () => OmniRoutePluginSettings
  private readonly request: typeof fetch
  private readonly now: () => number
  private cachedCachesData: { caches: Record<string, any>; providersMap: Map<string, any> } | null = null
  private cachedAt = 0

  constructor(options: OmniRouteQuotaManagerOptions = {}) {
    if (options.baseUrl !== undefined) this.explicitBaseUrl = normalizeBaseUrl(options.baseUrl)
    if (options.apiKey !== undefined) this.explicitApiKey = options.apiKey
    if (options.mergeSubscriptions !== undefined) this.explicitMergeSubscriptions = options.mergeSubscriptions
    if (options.displayedQuotas !== undefined) this.explicitDisplayedQuotas = options.displayedQuotas
    this.context = options.context
    this.getSettingsFn = options.getSettings
    this.request = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
  }

  updateConfig(config: {
    baseUrl?: string
    apiKey?: string
    mergeSubscriptions?: boolean
    displayedQuotas?: import('../settings.js').DisplayedQuotasOption
  }): void {
    if (config.baseUrl !== undefined) this.explicitBaseUrl = normalizeBaseUrl(config.baseUrl)
    if (config.apiKey !== undefined) this.explicitApiKey = config.apiKey
    if (config.mergeSubscriptions !== undefined) this.explicitMergeSubscriptions = config.mergeSubscriptions
    if (config.displayedQuotas !== undefined) this.explicitDisplayedQuotas = config.displayedQuotas
    this.cachedCachesData = null
    this.cachedAt = 0
  }

  getEffectiveConfig(): OmniRoutePluginSettings {
    const fromContext = this.context
      ? getOmniRouteSettings(this.context)
      : this.getSettingsFn
        ? this.getSettingsFn()
        : getOmniRouteSettings()

    return {
      baseUrl: this.explicitBaseUrl ?? fromContext.baseUrl,
      apiKey: this.explicitApiKey ?? fromContext.apiKey,
      mergeSubscriptions: this.explicitMergeSubscriptions ?? fromContext.mergeSubscriptions,
      displayedQuotas: this.explicitDisplayedQuotas ?? fromContext.displayedQuotas,
    }
  }

  private async fetchJson(path: string): Promise<unknown> {
    const { baseUrl, apiKey } = this.getEffectiveConfig()
    const cleanBase = normalizeBaseUrl(baseUrl)
    const url = `${cleanBase}${path}`
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    try {
      const res = await this.request(url, {
        headers,
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        return (await res.json()) as unknown
      }
      // If root path 404s, try fallback with /v1/ prefix
      if (res.status === 404 && !path.startsWith('/v1')) {
        const fallbackUrl = `${cleanBase}/v1${path}`
        const fallbackRes = await this.request(fallbackUrl, {
          headers,
          signal: AbortSignal.timeout(5000),
        }).catch(() => null)
        if (fallbackRes && fallbackRes.ok) {
          return (await fallbackRes.json()) as unknown
        }
      }
      throw new Error(`OmniRoute ${path} responded with ${res.status}`)
    } catch (err) {
      throw err
    }
  }

  private async loadData(): Promise<{ caches: Record<string, any>; providersMap: Map<string, any> }> {
    if (this.cachedCachesData && this.now() - this.cachedAt < CACHE_TTL_MS) {
      return this.cachedCachesData
    }

    const [plData, quotaData] = await Promise.all([
      this.fetchJson('/api/usage/provider-limits').catch(() => null),
      this.fetchJson('/api/usage/quota').catch(() => null),
    ])

    const rawCaches = (plData as any)?.caches ?? {}
    const parsedProviders = parseProvidersRaw((quotaData as any)?.providers)

    const providersMap = new Map<string, any>()
    const activeConnectionIds = new Set<string>()
    for (const p of parsedProviders) {
      if (p.connectionId) {
        providersMap.set(p.connectionId, p)
        activeConnectionIds.add(p.connectionId)
      }
    }

    // Filter rawCaches: include all valid cache entries
    const caches: Record<string, any> = {}
    for (const [connId, connData] of Object.entries(rawCaches)) {
      if (activeConnectionIds.size === 0 || activeConnectionIds.has(connId)) {
        caches[connId] = connData
      }
    }

    const result = { caches, providersMap }
    this.cachedCachesData = result
    this.cachedAt = this.now()
    return result
  }

  async discoverConnections(): Promise<Array<{ connectionId: string; sectionName: string; providerGroup: string }>> {
    try {
      const { caches, providersMap } = await this.loadData()
      const list: Array<{ connectionId: string; sectionName: string; providerGroup: string }> = []
      const seenNames = new Map<string, number>()

      for (const [connId, connData] of Object.entries(caches)) {
        if (!connData || typeof connData !== 'object') continue
        const pMeta = providersMap.get(connId) ?? {}
        const providerSlug = pMeta.provider ?? (connData.plan ? String(connData.plan).toLowerCase() : '')
        const accountName = pMeta.name ?? undefined
        const planName = connData.plan ?? undefined

        const count = (seenNames.get(providerSlug) ?? 0) + 1
        seenNames.set(providerSlug, count)

        const sectionName = formatSectionName(providerSlug, accountName, planName, count)
        const quotas = connData.quotas ?? {}
        const validCount = Object.values(quotas).filter(
          (q: any) => q && !q.unlimited && (asNumber(q.total) ?? asNumber(q.limit) ?? 0) > 0,
        ).length

        if (validCount > 0) {
          list.push({ connectionId: connId, sectionName, providerGroup: providerSlug })
        }
      }

      // Group connections of the same type together
      list.sort((a, b) => {
        if (a.providerGroup !== b.providerGroup) {
          return a.providerGroup.localeCompare(b.providerGroup)
        }
        return a.sectionName.localeCompare(b.sectionName)
      })

      return list
    } catch {
      return []
    }
  }

  async getQuotaForConnection(connectionId: string, sectionName: string): Promise<QuotaSource> {
    const source: QuotaSource = {
      id: `omniroute-${connectionId}`,
      name: sectionName,
      metrics: [],
    }

    try {
      const { caches, providersMap } = await this.loadData()
      const connData = caches[connectionId]
      if (!connData || !connData.quotas) return source

      const pMeta = providersMap.get(connectionId) ?? {}
      const providerSlug = (pMeta.provider ?? (connData.plan ? String(connData.plan) : '')).toLowerCase()
      const plan = String(connData.plan || '').toLowerCase()
      const isAntigravity = providerSlug === 'antigravity' || plan === 'pro'
      const quotas = connData.quotas as Record<string, any>

      if (isAntigravity) {
        // Group by model family (Gemini, Claude, GPT-OSS, etc.)
        const familyTotals = new Map<
          string,
          { used: number; limit: number; resetsAt?: string; displayName: string }
        >()

        for (const [key, q] of Object.entries(quotas)) {
          if (!q || q.unlimited) continue
          const used = asNumber(q.used) ?? asNumber(q.quotaUsed) ?? 0
          const limit = asNumber(q.total) ?? asNumber(q.quotaTotal) ?? 0
          if (limit <= 0) continue
          const resetsAt = q.resetAt ? String(q.resetAt) : undefined

          const lowerKey = key.toLowerCase()
          let familyKey = ''
          let displayName = ''
          if (lowerKey.includes('gemini')) {
            familyKey = 'gemini'
            displayName = 'Gemini'
          } else if (lowerKey.includes('claude')) {
            familyKey = 'claude'
            displayName = 'Claude'
          } else if (lowerKey.includes('gpt-oss') || lowerKey.includes('gpt_oss')) {
            familyKey = 'gpt-oss'
            displayName = 'GPT-OSS'
          } else {
            familyKey = key
            displayName = formatModelName(key)
          }

          const existing = familyTotals.get(familyKey)
          if (!existing) {
            familyTotals.set(familyKey, { used, limit, resetsAt, displayName })
          } else {
            const newUsed = Math.max(existing.used, used)
            const newLimit = Math.max(existing.limit, limit)
            const newReset = resetsAt || existing.resetsAt
            familyTotals.set(familyKey, {
              used: newUsed,
              limit: newLimit,
              resetsAt: newReset,
              displayName: existing.displayName,
            })
          }
        }

        // Fixed order: Gemini first, Claude second, then others
        const order = ['gemini', 'claude', 'gpt-oss']
        const sortedEntries = Array.from(familyTotals.entries()).sort((a, b) => {
          const idxA = order.indexOf(a[0])
          const idxB = order.indexOf(b[0])
          return (idxA >= 0 ? idxA : 99) - (idxB >= 0 ? idxB : 99)
        })

        for (const [, fam] of sortedEntries) {
          source.metrics.push({
            kind: 'windowed',
            label: 'Requests',
            used: fam.used,
            limit: fam.limit,
            window: 'day',
            model: fam.displayName,
            ...(fam.resetsAt ? { resetsAt: fam.resetsAt } : {}),
          })
        }
      } else {
        const metricsMap = new Map<string, Extract<QuotaMetric, { kind: 'windowed' }>>()

        for (const [key, q] of Object.entries(quotas)) {
          if (!q || q.unlimited) continue
          const used = asNumber(q.used) ?? asNumber(q.quotaUsed) ?? asNumber(q.tokensUsed) ?? 0
          const limit = asNumber(q.total) ?? asNumber(q.quotaTotal) ?? asNumber(q.tokenLimit) ?? 0
          if (limit <= 0) continue

          const window = normalizeWindow(q.window ?? q.period ?? q.resetInterval ?? q.displayName ?? key)
          const label = q.displayName ? String(q.displayName) : formatModelName(key)
          const resetsAt = q.resetAt ? String(q.resetAt) : undefined

          const existing = metricsMap.get(window)
          if (!existing || used > existing.used) {
            metricsMap.set(window, {
              kind: 'windowed',
              label,
              used,
              limit,
              window,
              ...(resetsAt ? { resetsAt } : {}),
            })
          }
        }

        const windowOrder: Record<string, number> = { hour: 1, day: 2, week: 3, month: 4 }
        source.metrics = Array.from(metricsMap.values()).sort(
          (a, b) => (windowOrder[a.window] || 5) - (windowOrder[b.window] || 5),
        )
      }

      return source
    } catch (error) {
      this.context?.logger?.warn?.(`OmniRoute connection quota unavailable (${sectionName})`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return source
    }
  }

  async getAllQuotaSources(): Promise<QuotaSource[]> {
    const connections = await this.discoverConnections()
    if (connections.length === 0) {
      return []
    }

    const sources = await Promise.all(
      connections.map((c) => this.getQuotaForConnection(c.connectionId, c.sectionName)),
    )

    const valid = sources.filter((s) => s.metrics && s.metrics.length > 0)
    if (this.getEffectiveConfig().mergeSubscriptions) {
      return mergeQuotaSources(valid)
    }

    return valid
  }

  async registerProviders(registry?: PluginRegistry): Promise<void> {
    const dynamicProvider = new OmniRouteDynamicQuotaProvider(this)

    // 1. Put in pending list so openfox-quota picks it up whenever it loads
    const pending = ((globalThis as any)[PENDING_PROVIDERS_KEY] ??= [])
    if (!pending.some((p: any) => p && p.id === dynamicProvider.id)) {
      pending.push(dynamicProvider)
    }

    // 2. Register with openfox-quota via global quota manager if present
    const globalMgr = (globalThis as any)[GLOBAL_QUOTA_KEY]
    if (globalMgr && typeof globalMgr.registerProvider === 'function') {
      globalMgr.registerProvider(dynamicProvider)
    }

    // 3. Register via registry.registerQuotaProvider if present
    if (registry && typeof registry.registerQuotaProvider === 'function') {
      registry.registerQuotaProvider(dynamicProvider)
    }
  }

  async syncQuota(registry?: PluginRegistry): Promise<{ success: boolean; sources: QuotaSource[] }> {
    this.cachedCachesData = null
    this.cachedAt = 0
    const sources = await this.getAllQuotaSources()

    // Push sources into global quota manager
    const globalMgr = (globalThis as any)[GLOBAL_QUOTA_KEY]
    if (globalMgr && typeof globalMgr.submitSource === 'function') {
      if (typeof globalMgr.clearPushedSources === 'function') {
        globalMgr.clearPushedSources((id: string) => id.startsWith('omniroute'))
      } else if (globalMgr.pushedSources instanceof Map) {
        for (const key of Array.from(globalMgr.pushedSources.keys())) {
          if (typeof key === 'string' && key.startsWith('omniroute')) {
            globalMgr.pushedSources.delete(key)
          }
        }
      }
      for (const src of sources) {
        if (src.metrics && src.metrics.length > 0) {
          globalMgr.submitSource(src)
        }
      }
    }

    if (registry && typeof registry.registerQuotaProvider === 'function') {
      await this.registerProviders(registry)
    }

    return { success: true, sources }
  }
}

export class OmniRouteDynamicQuotaProvider implements QuotaProvider {
  readonly id = 'omniroute'
  readonly name = 'OmniRoute Gateway'

  constructor(private readonly manager: OmniRouteQuotaManager) {}

  async getQuota(): Promise<QuotaSource> {
    const sources = await this.manager.getAllQuotaSources()

    const globalMgr = (globalThis as any)[GLOBAL_QUOTA_KEY]
    // Push all connection sources to quota manager so each appears in modal
    if (globalMgr && typeof globalMgr.submitSource === 'function') {
      if (typeof globalMgr.clearPushedSources === 'function') {
        globalMgr.clearPushedSources((id: string) => id.startsWith('omniroute'))
      } else if (globalMgr.pushedSources instanceof Map) {
        for (const key of Array.from(globalMgr.pushedSources.keys())) {
          if (typeof key === 'string' && key.startsWith('omniroute')) {
            globalMgr.pushedSources.delete(key)
          }
        }
      }
      for (const src of sources) {
        if (src.metrics && src.metrics.length > 0) {
          globalMgr.submitSource(src)
        }
      }
    }

    // Return first source with metrics or an aggregate
    const firstWithMetrics = sources.find((s) => s.metrics && s.metrics.length > 0)
    if (firstWithMetrics) {
      return firstWithMetrics
    }
    return sources[0] ?? { id: 'omniroute', name: 'OmniRoute Gateway', metrics: [] }
  }
}

export class OmniRouteSectionQuotaProvider implements QuotaProvider {
  readonly id: string
  readonly name: string

  constructor(
    readonly connectionId: string,
    readonly sectionName: string,
    private readonly manager: OmniRouteQuotaManager,
  ) {
    this.id = `omniroute-${connectionId}`
    this.name = sectionName
  }

  async getQuota(): Promise<QuotaSource> {
    return this.manager.getQuotaForConnection(this.connectionId, this.sectionName)
  }
}
