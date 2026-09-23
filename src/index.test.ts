import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { register } from './index.js'
import { OmniRouteDynamicQuotaProvider } from './quota/omniroute.js'
import type { PluginRegistry } from './quota/contract.js'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

describe('register (OpenFox v2 plugin)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockFetch.mockResolvedValue(jsonResponse({ caches: {}, providers: [] }))
  })

  afterEach(() => {
    mockFetch.mockReset()
  })

  function createMockRegistry(settingsValues: Record<string, string> = {}) {
    const registeredQuota: unknown[] = []
    let settingsSchema: any = null
    const rpcHandlers = new Map<string, Function>()
    const tools: any[] = []
    const hooks = new Map<string, Function>()

    const registry: PluginRegistry = {
      runtime: { mode: 'production', configDirectory: '/tmp/openfox-test-config' },
      context: {
        id: 'openfox-omniroute-quota',
        version: '2.0.0',
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
        settings: vi.fn().mockReturnValue(settingsValues),
      },
      registerSettings: (schema: any) => {
        settingsSchema = schema
      },
      registerQuotaProvider: (provider: unknown) => {
        registeredQuota.push(provider)
      },
      registerRpc: (method: string, handler: any) => {
        rpcHandlers.set(method, handler)
      },
      registerTool: (tool: any) => {
        tools.push(tool)
      },
      registerHook: (event: string, handler: any) => {
        hooks.set(event, handler)
      },
    }

    return {
      registry,
      registeredQuota,
      getSettingsSchema: () => settingsSchema,
      rpcHandlers,
      tools,
      hooks,
    }
  }

  it('registers settings schema, quota providers, RPCs, tools, and hooks', async () => {
    const { registry, registeredQuota, getSettingsSchema, rpcHandlers, tools, hooks } = createMockRegistry({
      baseUrl: 'http://localhost:20128',
      apiKey: 'sk-test-key',
    })

    await register(registry)

    // Settings
    const schema = getSettingsSchema()
    expect(schema).not.toBeNull()
    expect(schema.fields).toHaveLength(3)
    expect(schema.fields[0].key).toBe('baseUrl')
    expect(schema.fields[0].label.en).toBe('OmniRoute Server URL')
    expect(schema.fields[0].label.fr).toBe('URL du serveur OmniRoute')
    expect(schema.fields[1].key).toBe('apiKey')
    expect(schema.fields[1].secret).toBe(true)
    expect(schema.fields[2].key).toBe('mergeSubscriptions')

    // Quota Providers
    expect(registeredQuota.length).toBeGreaterThanOrEqual(1)
    expect(registeredQuota[0]).toBeInstanceOf(OmniRouteDynamicQuotaProvider)

    // RPCs
    expect(rpcHandlers.has('omniroute.getQuota')).toBe(true)
    expect(rpcHandlers.has('omniroute.syncQuota')).toBe(true)

    // Tools
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('get_omniroute_quota')

    // Hooks
    expect(hooks.has('turn.completed')).toBe(true)
  })

  it('resolves dynamic settings directly from PluginContext when syncing or fetching', async () => {
    const { registry, rpcHandlers } = createMockRegistry({
      baseUrl: 'https://custom-gateway.local',
      apiKey: 'sk-dynamic-456',
    })

    await register(registry)
    const getQuotaRpc = rpcHandlers.get('omniroute.getQuota')!
    await getQuotaRpc({})

    expect(registry.context.settings).toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://custom-gateway.local'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-dynamic-456',
        }),
      }),
    )
  })

  it('executes RPC methods correctly', async () => {
    const { registry, rpcHandlers } = createMockRegistry()
    await register(registry)

    const getQuotaRpc = rpcHandlers.get('omniroute.getQuota')!
    const result = (await getQuotaRpc({})) as any
    expect(result.sources).toBeDefined()
    expect(Array.isArray(result.sources)).toBe(true)

    const syncQuotaRpc = rpcHandlers.get('omniroute.syncQuota')!
    const syncResult = (await syncQuotaRpc({})) as any
    expect(syncResult.success).toBe(true)
    expect(syncResult.sources).toBeDefined()
  })

  it('executes get_omniroute_quota tool', async () => {
    const { registry, tools } = createMockRegistry()
    await register(registry)

    const tool = tools[0]
    const result = await tool.execute({}, {})
    expect(result.success).toBe(true)
    const parsed = JSON.parse(result.output)
    expect(parsed.sources).toBeDefined()
  })

  it('runs turn.completed hook without throwing', async () => {
    const { registry, hooks } = createMockRegistry()
    await register(registry)

    const turnHook = hooks.get('turn.completed')!
    await expect(turnHook({ sessionId: 's1' })).resolves.toBeUndefined()
  })

  it('handles bare registry with minimal methods', async () => {
    const registry: PluginRegistry = {
      runtime: { configDirectory: '/tmp/openfox-minimal' },
      context: {
        settings: () => ({}),
      },
    }

    await expect(register(registry)).resolves.toBeUndefined()
  })
})
