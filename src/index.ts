import { join } from 'node:path'
import type { ProviderPluginRegistry } from 'openfox/provider'
import { OmniRouteQuotaManager } from './quota/omniroute.js'
import { PluginSettingsStore } from './settings.js'
import './quota/contract.js'

export async function register(registry: ProviderPluginRegistry): Promise<void> {
  const storageDir = join(
    registry.runtime.configDirectory,
    'plugins',
    'openfox-omniroute-quota',
  )
  const settingsStore = new PluginSettingsStore(join(storageDir, 'settings.json'))
  const initialSettings = await settingsStore.load()

  const manager = new OmniRouteQuotaManager({
    baseUrl: initialSettings.baseUrl,
    apiKey: initialSettings.apiKey,
  })

  if (typeof registry.registerSettings === 'function') {
    registry.registerSettings({
      title: 'OmniRoute Quota Configuration',
      description: 'Configure your OmniRoute server URL and API key to surface your quotas in OpenFox.',
      fields: [
        {
          key: 'baseUrl',
          label: 'OmniRoute Server URL',
          type: 'text',
          placeholder: 'http://localhost:20128',
          defaultValue: 'http://localhost:20128',
          required: true,
        },
        {
          key: 'apiKey',
          label: 'OmniRoute API Key',
          type: 'text',
          placeholder: 'sk-...',
          required: true,
        },
      ],
      async getSettings() {
        return settingsStore.load() as unknown as Record<string, unknown>
      },
      async saveSettings(values: Record<string, unknown>) {
        const updated = await settingsStore.save(values)
        manager.updateConfig(updated)
      },
    })
  }

  if (typeof registry.registerQuotaProvider === 'function') {
    await manager.registerProviders(registry)
  }
}

export {
  OmniRouteQuotaManager,
  OmniRouteSectionQuotaProvider,
} from './quota/omniroute.js'
export { PluginSettingsStore } from './settings.js'
