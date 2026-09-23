import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OmniRouteQuotaManager } from './omniroute.js'
import type { PluginContext, QuotaMetric } from './contract.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeManager(options: any = {}) {
  return new OmniRouteQuotaManager({ fetcher: mockFetch as any, ...options })
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

describe('OmniRouteQuotaManager', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })
  afterEach(() => {
    mockFetch.mockReset()
  })

  it('discovers account connections from OmniRoute', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          caches: {
            c2e36ceb: {
              plan: 'Copilot Business',
              quotas: {
                premium_interactions: {
                  used: 13791,
                  total: 20000,
                  remaining: 6209,
                  resetAt: '2026-09-01T00:00:00.000Z',
                  unlimited: false,
                },
              },
            },
            a70a035f: {
              plan: 'OpenCode Go',
              quotas: {
                weekly: {
                  used: 27.96,
                  total: 30,
                  remaining: 2.04,
                  resetAt: '2026-08-31T00:00:00.000Z',
                  unlimited: false,
                },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ providers: [] }))

    const manager = makeManager()
    const connections = await manager.discoverConnections()
    expect(connections).toHaveLength(2)
    expect(connections[0]!.connectionId).toBe('c2e36ceb')
    expect(connections[1]!.connectionId).toBe('a70a035f')
  })

  it('fetches and formats connection metrics for OpenCode Go', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          caches: {
            a70a035f: {
              plan: 'OpenCode Go',
              quotas: {
                session: { used: 142, total: 500, window: 'hour' },
                weekly: { used: 3200, total: 10000, window: 'week' },
                mcp_monthly: { used: 11800, total: 40000, window: 'month' },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ providers: [] }))

    const manager = makeManager()
    const source = await manager.getQuotaForConnection('a70a035f', 'OpenCode Go')
    expect(source.id).toBe('omniroute-a70a035f')
    expect(source.name).toBe('OpenCode Go')
    expect(source.metrics).toHaveLength(3)

    const m0 = source.metrics[0]!
    const m1 = source.metrics[1]!
    const m2 = source.metrics[2]!

    if (m0.kind !== 'windowed' || m1.kind !== 'windowed' || m2.kind !== 'windowed') {
      throw new Error('expected windowed metrics')
    }

    expect(m0.window).toBe('hour')
    expect(m0.used).toBe(142)
    expect(m0.limit).toBe(500)

    expect(m1.window).toBe('week')
    expect(m1.used).toBe(3200)

    expect(m2.window).toBe('month')
    expect(m2.used).toBe(11800)
  })

  it('categorizes and merges model families for Google Antigravity account', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          caches: {
            dafe13a9: {
              plan: 'Pro',
              quotas: {
                'gemini-3.6-flash-high': { used: 80, total: 200, window: 'hour' },
                'gemini-3.7-flash-tiered': { used: 120, total: 200, window: 'hour' },
                'claude-sonnet-4-6': { used: 35, total: 200, window: 'hour' },
                'claude-opus-4-6-thinking': { used: 75, total: 200, window: 'hour' },
                'gpt-oss-120b-medium': { used: 200, total: 200, window: 'hour' },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ providers: [] }))

    const manager = makeManager()
    const source = await manager.getQuotaForConnection('dafe13a9', 'Google Antigravity (jamesadamstidal2023)')
    expect(source.metrics).toHaveLength(3)

    const geminiMetric = source.metrics.find((m) => m.model === 'Gemini') as Extract<
      QuotaMetric,
      { kind: 'windowed' }
    >
    const claudeMetric = source.metrics.find((m) => m.model === 'Claude') as Extract<
      QuotaMetric,
      { kind: 'windowed' }
    >
    const gptOssMetric = source.metrics.find((m) => m.model === 'GPT-OSS') as Extract<
      QuotaMetric,
      { kind: 'windowed' }
    >

    expect(geminiMetric).toBeDefined()
    expect(claudeMetric).toBeDefined()
    expect(gptOssMetric).toBeDefined()
    expect(geminiMetric?.used).toBe(120)
    expect(geminiMetric?.limit).toBe(200)
    expect(claudeMetric?.used).toBe(75)
    expect(claudeMetric?.limit).toBe(200)
    expect(gptOssMetric?.used).toBe(200)
    expect(gptOssMetric?.limit).toBe(200)
  })

  it('reads dynamic baseUrl and apiKey from PluginContext', async () => {
    const context: PluginContext = {
      settings: vi.fn().mockReturnValue({
        baseUrl: 'https://dynamic.omniroute.local/v1',
        apiKey: 'sk-dynamic-key-99',
      }),
    }

    mockFetch
      .mockResolvedValueOnce(jsonResponse({ caches: {} }))
      .mockResolvedValueOnce(jsonResponse({ providers: [] }))

    const manager = makeManager({ context })
    await manager.discoverConnections()

    expect(context.settings).toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://dynamic.omniroute.local/api/usage/provider-limits'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-dynamic-key-99',
        }),
      }),
    )
  })

  it('merges identical subscriptions into a single card when mergeSubscriptions is enabled', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          caches: {
            acc1: {
              plan: 'Pro',
              quotas: {
                'gemini-3.7-flash-tiered': { used: 100, total: 1000, window: 'day' },
                'claude-sonnet-4-6': { used: 500, total: 1000, window: 'day' },
              },
            },
            acc2: {
              plan: 'Pro',
              quotas: {
                'gemini-3.7-flash-tiered': { used: 200, total: 1000, window: 'day' },
                'claude-sonnet-4-6': { used: 300, total: 1000, window: 'day' },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          providers: [
            { connectionId: 'acc1', name: 'user1', provider: 'antigravity' },
            { connectionId: 'acc2', name: 'user2', provider: 'antigravity' },
          ],
        }),
      )

    const manager = makeManager({ mergeSubscriptions: true })
    const sources = await manager.getAllQuotaSources()

    expect(sources).toHaveLength(1)
    expect(sources[0]!.name).toBe('Google Antigravity (2 accounts)')
    expect(sources[0]!.metrics).toHaveLength(2)

    const gemini = sources[0]!.metrics.find((m) => m.model === 'Gemini') as Extract<
      QuotaMetric,
      { kind: 'windowed' }
    >
    const claude = sources[0]!.metrics.find((m) => m.model === 'Claude') as Extract<
      QuotaMetric,
      { kind: 'windowed' }
    >

    expect(gemini).toBeDefined()
    expect(claude).toBeDefined()
    expect(gemini.used).toBe(300) // 100 + 200
    expect(gemini.limit).toBe(2000) // 1000 + 1000
    expect(claude.used).toBe(800) // 500 + 300
    expect(claude.limit).toBe(2000) // 1000 + 1000
  })
})
