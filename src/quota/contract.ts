import 'openfox/provider'

export type QuotaMetric =
  | {
      kind: 'windowed'
      label: string
      used: number
      limit: number
      window: 'hour' | 'day' | 'week' | 'month'
      model?: string
      resetsAt?: string
    }
  | {
      kind: 'token-balance'
      label: string
      total: number
      remaining: number
      model?: string
    }

export interface QuotaSource {
  id: string
  name: string
  metrics: QuotaMetric[]
}

export interface QuotaProvider {
  readonly id: string
  readonly name: string
  getQuota(): Promise<QuotaSource>
}

export interface PluginSettingField {
  key: string
  label: string
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea'
  placeholder?: string
  required?: boolean
  defaultValue?: unknown
  options?: Array<{ label: string; value: string }>
}

export interface PluginSettingsSpec {
  title: string
  description?: string
  fields: PluginSettingField[]
  getSettings?(): Promise<Record<string, unknown>>
  saveSettings?(values: Record<string, unknown>): Promise<void>
}

declare module 'openfox/provider' {
  interface ProviderPluginRegistry {
    registerQuotaProvider?(provider: QuotaProvider): void
    registerSettings?(spec: PluginSettingsSpec): void
  }
}
