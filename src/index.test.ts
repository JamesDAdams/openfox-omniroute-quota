import { describe, it, expect } from 'vitest'
import { register } from './index.js'
import { OmniRouteSectionQuotaProvider } from './quota/omniroute.js'

describe('register', () => {
  it('registers settings and 3 section QuotaProviders when registry supports them', async () => {
    const registeredQuota: unknown[] = []
    let settingsSpec: any = null

    const registry = {
      runtime: { configDirectory: '/tmp/openfox-test-config' },
      registerQuotaProvider: (provider: unknown) => {
        registeredQuota.push(provider)
      },
      registerSettings: (spec: unknown) => {
        settingsSpec = spec
      },
    } as any

    await register(registry)

    expect(settingsSpec).not.toBeNull()
    expect(settingsSpec.title).toBe('OmniRoute Quota Configuration')
    expect(settingsSpec.fields).toHaveLength(2)
    expect(settingsSpec.fields[0].label).toBe('OmniRoute Server URL')
    expect(settingsSpec.fields[1].label).toBe('OmniRoute API Key')

    expect(registeredQuota).toHaveLength(3)
    expect(registeredQuota[0]).toBeInstanceOf(OmniRouteSectionQuotaProvider)
  })

  it('handles getSettings and saveSettings callbacks', async () => {
    let settingsSpec: any = null

    const registry = {
      runtime: { configDirectory: '/tmp/openfox-test-config-2' },
      registerSettings: (spec: unknown) => {
        settingsSpec = spec
      },
    } as any

    await register(registry)

    await settingsSpec.saveSettings({
      baseUrl: 'https://omniroute-custom.local',
      apiKey: 'sk-custom-123',
    })

    const loaded = await settingsSpec.getSettings()
    expect(loaded.baseUrl).toBe('https://omniroute-custom.local')
    expect(loaded.apiKey).toBe('sk-custom-123')
  })

  it('does nothing when registerQuotaProvider and registerSettings are absent', async () => {
    const registry = { runtime: { configDirectory: '/tmp/openfox-test-config-3' } } as any
    await expect(register(registry)).resolves.toBeUndefined()
  })
})
