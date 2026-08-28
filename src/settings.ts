import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface OmniRoutePluginSettings {
  baseUrl: string
  apiKey: string
}

export const DEFAULT_SETTINGS: OmniRoutePluginSettings = {
  baseUrl: process.env.OMNIROUTE_BASE_URL ?? 'http://localhost:20128',
  apiKey: process.env.OMNIROUTE_API_KEY ?? '',
}

export class PluginSettingsStore {
  constructor(private readonly settingsFilePath: string) {}

  async load(): Promise<OmniRoutePluginSettings> {
    try {
      const content = await readFile(this.settingsFilePath, 'utf8')
      const parsed = JSON.parse(content) as Partial<OmniRoutePluginSettings>
      return {
        baseUrl: parsed.baseUrl || DEFAULT_SETTINGS.baseUrl,
        apiKey: parsed.apiKey ?? DEFAULT_SETTINGS.apiKey,
      }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  async save(values: Record<string, unknown>): Promise<OmniRoutePluginSettings> {
    const existing = await this.load()
    const newApiKey = typeof values.apiKey === 'string' ? values.apiKey.trim() : ''

    const updated: OmniRoutePluginSettings = {
      baseUrl:
        typeof values.baseUrl === 'string' && values.baseUrl.trim()
          ? values.baseUrl.trim()
          : existing.baseUrl || DEFAULT_SETTINGS.baseUrl,
      apiKey: newApiKey || existing.apiKey,
    }

    await mkdir(dirname(this.settingsFilePath), { recursive: true })
    await writeFile(this.settingsFilePath, JSON.stringify(updated, null, 2), { mode: 0o600 })
    return updated
  }
}
