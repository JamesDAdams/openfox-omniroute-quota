import type { PluginRegistry } from './quota/contract.js'
import { OmniRouteQuotaManager } from './quota/omniroute.js'
import { SETTINGS_SCHEMA } from './settings.js'

export async function register(registry: PluginRegistry): Promise<void> {
  const { context } = registry

  const manager = new OmniRouteQuotaManager({
    context,
  })

  // 1. Register OpenFox v2 Declarative Settings Schema
  if (typeof registry.registerSettings === 'function') {
    registry.registerSettings(SETTINGS_SCHEMA)
  }

  // 2. Register Quota Providers with openfox-quota plugin (via registry and global manager)
  await manager.registerProviders(registry)
  context?.logger?.info?.('Registered OmniRoute quota providers')

  // 3. Register RPC Methods for manual sync and data retrieval
  if (typeof registry.registerRpc === 'function') {
    registry.registerRpc('omniroute.getQuota', async (params) => {
      const connectionId = typeof params?.['connectionId'] === 'string' ? params['connectionId'] : undefined
      if (connectionId) {
        const source = await manager.getQuotaForConnection(connectionId, connectionId)
        return { source }
      }
      const sources = await manager.getAllQuotaSources()
      return { sources }
    })

    registry.registerRpc('omniroute.syncQuota', async () => {
      return await manager.syncQuota(registry)
    })
  }

  // 4. Register LLM Tool
  if (typeof registry.registerTool === 'function') {
    registry.registerTool({
      name: 'get_omniroute_quota',
      description: 'Retrieve current model quota limits and usage across OmniRoute providers and connections.',
      parameters: {
        type: 'object',
        properties: {
          connectionId: {
            type: 'string',
            description: 'Optional connection ID or provider slug filter',
          },
        },
      },
      execute: async (args) => {
        const connectionId = typeof args['connectionId'] === 'string' ? args['connectionId'] : undefined
        if (connectionId) {
          const source = await manager.getQuotaForConnection(connectionId, connectionId)
          return {
            success: true,
            output: JSON.stringify(source, null, 2),
          }
        }
        const sources = await manager.getAllQuotaSources()
        return {
          success: true,
          output: JSON.stringify({ sources }, null, 2),
        }
      },
    })
  }

  // 5. Register Hook on turn.completed to ensure fresh stats
  if (typeof registry.registerHook === 'function') {
    registry.registerHook('turn.completed', async () => {
      try {
        await manager.syncQuota(registry)
      } catch (err) {
        context?.logger?.debug?.('Failed to sync OmniRoute quota on turn completion', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
  }

  context?.logger?.info?.('openfox-omniroute-quota plugin initialized successfully')
}

export {
  OmniRouteQuotaManager,
  OmniRouteDynamicQuotaProvider,
  OmniRouteSectionQuotaProvider,
} from './quota/omniroute.js'
export {
  getOmniRouteSettings,
  normalizeBaseUrl,
  SETTINGS_SCHEMA,
  DEFAULT_SETTINGS,
  type OmniRoutePluginSettings,
} from './settings.js'
export type * from './quota/contract.js'
