export type LocalizedString = { en: string; fr: string }

export type QuotaMetric =
  | {
      kind: 'windowed'
      label: string
      used: number
      limit: number
      window: 'hour' | 'day' | 'week' | 'month'
      model?: string
      /** ISO timestamp when the window resets. */
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
  description?: string
  metrics: QuotaMetric[]
}

export interface QuotaProvider {
  readonly id: string
  readonly name: string
  getQuota(): Promise<QuotaSource> | QuotaSource
}

export type PluginSettingValue = string | number | boolean

export interface PluginSettingsField {
  key: string
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea' | 'path'
  label: LocalizedString
  description?: LocalizedString
  default?: PluginSettingValue
  options?: { value: string; label: LocalizedString }[]
  required?: boolean
  secret?: boolean
  placeholder?: string
}

export interface PluginSettingsSchema {
  fields: PluginSettingsField[]
}

export interface PluginToolContext {
  sessionId?: string
  workdir?: string
  projectId?: string
  signal?: AbortSignal
}

export interface PluginToolResult {
  success: boolean
  output?: string
  error?: string
}

export interface PluginContext {
  readonly id?: string
  readonly version?: string
  readonly runtime?: { mode: 'production' | 'development'; configDirectory: string }
  readonly logger?: {
    debug(message: string, context?: Record<string, unknown>): void
    info(message: string, context?: Record<string, unknown>): void
    warn(message: string, context?: Record<string, unknown>): void
    error(message: string, context?: Record<string, unknown>): void
  }
  readonly storage?: {
    get(key: string): unknown
    set(key: string, value: unknown): void
  }
  settings(scope?: 'global' | 'project', projectId?: string): Record<string, PluginSettingValue>
  notify?(request: {
    title: LocalizedString
    body?: LocalizedString
    level?: 'info' | 'success' | 'warning' | 'error'
  }): void
  publish?(panelId: string | undefined, key: string, value: unknown): void
}

export interface PluginRegistry {
  readonly runtime: { mode?: 'production' | 'development'; configDirectory: string }
  readonly context: PluginContext

  registerTool?(tool: {
    name: string
    description: string
    parameters: Record<string, unknown>
    execute(args: Record<string, unknown>, context: PluginToolContext): Promise<PluginToolResult>
  }): void
  registerSettings?(schema: PluginSettingsSchema): void
  registerHook?(event: string, handler: (payload: any) => void | Promise<void>): void
  registerRpc?(
    method: string,
    handler: (params: Record<string, unknown>, context: PluginToolContext) => unknown | Promise<unknown>,
  ): void
  registerQuotaProvider?(provider: QuotaProvider): void
}
