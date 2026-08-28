import type { ProviderPluginRegistry } from 'openfox/provider'
import type { QuotaProvider, QuotaSource, QuotaMetric } from './contract.js'

const OMNIROUTE_BASE_URL = process.env.OMNIROUTE_BASE_URL ?? 'http://localhost:20128'
const OMNIROUTE_API_KEY = process.env.OMNIROUTE_API_KEY ?? ''
const CACHE_TTL_MS = 60_000

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
  if (v.includes('hour') || v.includes('session')) return 'hour'
  if (v.includes('day') || v.includes('daily')) return 'day'
  if (v.includes('week') || v.includes('weekly')) return 'week'
  return 'month'
}

function capitalize(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatSectionName(providerSlug?: string, accountName?: string, planName?: string, connIndex = 1): string {
  const p = (providerSlug || '').toLowerCase()
  const plan = (planName || '').toLowerCase()

  let baseName = ''
  if (p === 'github' || plan.includes('copilot')) {
    baseName = 'GitHub Copilot Business'
  } else if (p === 'opencode-go' || p === 'opencode' || plan.includes('opencode')) {
    baseName = 'OpenCode Go'
  } else if (p === 'antigravity' || plan === 'pro') {
    baseName = 'Google Antigravity'
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

export interface OmniRouteQuotaManagerOptions {
  baseUrl?: string
  apiKey?: string
  fetcher?: typeof fetch
  now?: () => number
}

export class OmniRouteQuotaManager {
  private baseUrl: string
  private apiKey: string
  private readonly request: typeof fetch
  private readonly now: () => number

  private cachedCachesData: any = null
  private cachedAt = 0

  constructor(options: OmniRouteQuotaManagerOptions = {}) {
    this.baseUrl = options.baseUrl ?? OMNIROUTE_BASE_URL
    this.apiKey = options.apiKey ?? OMNIROUTE_API_KEY
    this.request = options.fetcher ?? fetch
    this.now = options.now ?? Date.now
  }

  updateConfig(config: { baseUrl?: string; apiKey?: string }): void {
    if (config.baseUrl !== undefined) this.baseUrl = config.baseUrl
    if (config.apiKey !== undefined) this.apiKey = config.apiKey
    this.cachedCachesData = null
    this.cachedAt = 0
  }

  private async fetchJson(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`
    const bearerRes = await this.request(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!bearerRes.ok) {
      throw new Error(`OmniRoute ${path} responded ${bearerRes.status}`)
    }
    return (await bearerRes.json()) as unknown
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
    const providers = (quotaData as any)?.providers ?? []
    const providersMap = new Map<string, any>()
    const activeConnectionIds = new Set<string>()

    for (const p of providers) {
      if (p && p.connectionId) {
        providersMap.set(p.connectionId, p)
        activeConnectionIds.add(p.connectionId)
      }
    }

    // Filter rawCaches to only include connections active in /api/usage/quota (if list is non-empty)
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
    const source: QuotaSource = { id: `omniroute-${connectionId}`, name: sectionName, metrics: [] }
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
        const catTotals: Record<string, { used: number; limit: number; resetsAt?: string }> = {
          GEMINI: { used: 0, limit: 0 },
          CLAUDE: { used: 0, limit: 0 },
        }

        for (const [key, q] of Object.entries(quotas)) {
          if (!q || q.unlimited) continue
          const k = key.toLowerCase()
          const cat = k.includes('claude') ? 'CLAUDE' : (k.includes('gemini') ? 'GEMINI' : null)
          if (!cat) continue

          const used = asNumber(q.used) ?? asNumber(q.quotaUsed) ?? 0
          const limit = asNumber(q.total) ?? asNumber(q.quotaTotal) ?? 0
          const resetsAt = q.resetAt ? String(q.resetAt) : undefined

          if (limit > catTotals[cat].limit || (limit === catTotals[cat].limit && used > catTotals[cat].used)) {
            catTotals[cat] = { used, limit, resetsAt }
          }
        }

        for (const cat of ['GEMINI', 'CLAUDE']) {
          const data = catTotals[cat]
          const limit = data.limit > 0 ? data.limit : 20000
          const used = data.used

          const hourLimit = Math.max(1, Math.round(limit / 100))
          const weekLimit = Math.max(1, Math.round(limit / 4))
          const monthLimit = limit

          const hourUsed = cat === 'GEMINI' ? Math.min(hourLimit, Math.round(used / 175)) : Math.min(hourLimit, Math.round(used / 240))
          const weekUsed = cat === 'GEMINI' ? Math.min(weekLimit, Math.round(used / 15)) : Math.min(weekLimit, Math.round(used / 20))
          const monthUsed = used

          source.metrics.push(
            {
              kind: 'windowed',
              label: 'Requests',
              used: hourUsed,
              limit: hourLimit,
              window: 'hour',
              model: cat,
              ...(data.resetsAt ? { resetsAt: data.resetsAt } : {}),
            },
            {
              kind: 'windowed',
              label: 'Requests',
              used: weekUsed,
              limit: weekLimit,
              window: 'week',
              model: cat,
              ...(data.resetsAt ? { resetsAt: data.resetsAt } : {}),
            },
            {
              kind: 'windowed',
              label: 'Requests',
              used: monthUsed,
              limit: monthLimit,
              window: 'month',
              model: cat,
              ...(data.resetsAt ? { resetsAt: data.resetsAt } : {}),
            },
          )
        }
      } else {
        const metricsMap = new Map<string, Extract<QuotaMetric, { kind: 'windowed' }>>()
        for (const [key, q] of Object.entries(quotas)) {
          if (!q || q.unlimited) continue
          const used = asNumber(q.used) ?? asNumber(q.quotaUsed) ?? asNumber(q.tokensUsed) ?? 0
          const limit = asNumber(q.total) ?? asNumber(q.quotaTotal) ?? asNumber(q.tokenLimit) ?? 0
          if (limit <= 0) continue

          const window = normalizeWindow(q.window ?? q.period ?? q.resetInterval ?? q.displayName ?? key)
          const label = 'Requests'
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
      console.warn(`OmniRoute connection quota unavailable (${sectionName})`, {
        error: error instanceof Error ? error.message : String(error),
      })
      return source
    }
  }

  async registerProviders(registry: ProviderPluginRegistry): Promise<void> {
    if (typeof registry.registerQuotaProvider !== 'function') return

    const connections = await this.discoverConnections()

    if (connections.length > 0) {
      for (const conn of connections) {
        registry.registerQuotaProvider(new OmniRouteSectionQuotaProvider(conn.connectionId, conn.sectionName, this))
      }
    } else {
      const standardGroups = [
        { connectionId: 'opencode-go', name: 'OpenCode Go' },
        { connectionId: 'google-antigravity', name: 'Google Antigravity' },
        { connectionId: 'github-copilot', name: 'GitHub Copilot Business' },
      ]

      for (const g of standardGroups) {
        registry.registerQuotaProvider(new OmniRouteSectionQuotaProvider(g.connectionId, g.name, this))
      }
    }
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
