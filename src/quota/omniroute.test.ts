import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { OmniRouteQuotaManager } from './omniroute.js'

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
                premium_interactions: { used: 13791, total: 20000, remaining: 6209, resetAt: '2026-09-01T00:00:00.000Z', unlimited: false },
              },
            },
            a70a035f: {
              plan: 'OpenCode Go',
              quotas: {
                weekly: { used: 27.96, total: 30, remaining: 2.04, resetAt: '2026-08-31T00:00:00.000Z', unlimited: false },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ providers: [] }))

    const manager = makeManager()
    const connections = await manager.discoverConnections()
    expect(connections).toHaveLength(2)
    expect(connections[0].connectionId).toBe('c2e36ceb')
    expect(connections[1].connectionId).toBe('a70a035f')
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

    const m0 = source.metrics[0]
    const m1 = source.metrics[1]
    const m2 = source.metrics[2]

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

  it('categorizes models (GEMINI, CLAUDE) for Google Antigravity account', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          caches: {
            dafe13a9: {
              plan: 'Pro',
              quotas: {
                'gemini-3.6-flash-high': { used: 80, total: 200, window: 'hour' },
                'claude-sonnet-4-6': { used: 35, total: 200, window: 'hour' },
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ providers: [] }))

    const manager = makeManager()
    const source = await manager.getQuotaForConnection('dafe13a9', 'Google Antigravity (jamesadamstidal2023)')
    expect(source.metrics).toHaveLength(6)

    const geminiHour = source.metrics.find((m: any) => m.model === 'GEMINI' && m.window === 'hour')
    const claudeHour = source.metrics.find((m: any) => m.model === 'CLAUDE' && m.window === 'hour')

    expect(geminiHour).toBeDefined()
    expect(claudeHour).toBeDefined()
  })
})
