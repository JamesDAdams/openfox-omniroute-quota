import type { PluginContext, PluginSettingsSchema } from './quota/contract.js'

export type DisplayedQuotasOption = 'all' | 'gemini_claude' | 'gemini' | 'claude'

export interface OmniRoutePluginSettings {
  baseUrl: string
  apiKey: string
  mergeSubscriptions: boolean
  displayedQuotas?: DisplayedQuotasOption
}

export const DEFAULT_SETTINGS: OmniRoutePluginSettings = {
  baseUrl: process.env.OMNIROUTE_BASE_URL ?? 'http://localhost:20128',
  apiKey: process.env.OMNIROUTE_API_KEY ?? '',
  mergeSubscriptions: false,
  displayedQuotas: 'all',
}

export function normalizeBaseUrl(rawUrl?: string): string {
  let u = (rawUrl || '').trim().replace(/\/+$/, '')
  if (!u) return 'http://localhost:20128'
  if (u.endsWith('/v1')) {
    u = u.slice(0, -3).replace(/\/+$/, '')
  }
  return u || 'http://localhost:20128'
}

export const SETTINGS_SCHEMA: PluginSettingsSchema = {
  fields: [
    {
      key: 'baseUrl',
      type: 'text',
      label: {
        en: 'OmniRoute Server URL',
        fr: 'URL du serveur OmniRoute',
      },
      description: {
        en: 'Base URL of your OmniRoute gateway server (without /v1, e.g. https://omniroute.example.com).',
        fr: 'URL de base de votre serveur passerelle OmniRoute (sans /v1, ex : https://omniroute.example.com).',
      },
      default: 'http://localhost:20128',
      placeholder: 'http://localhost:20128',
      required: true,
    },
    {
      key: 'apiKey',
      type: 'password',
      secret: true,
      label: {
        en: 'OmniRoute API Key',
        fr: 'Clé API OmniRoute',
      },
      description: {
        en: 'API key for OmniRoute management endpoints. (Stored securely on server)',
        fr: 'Clé d’API pour les points d’accès OmniRoute. (Stockée de manière sécurisée sur le serveur)',
      },
      placeholder: '••••••••••••••••',
      required: true,
    },
    {
      key: 'mergeSubscriptions',
      type: 'boolean',
      label: {
        en: 'Merge identical subscriptions',
        fr: 'Fusionner les abonnements identiques',
      },
      description: {
        en: 'Combine multiple accounts for the same provider (e.g. 4 Google Antigravity subscriptions) into a single card with summed quota limits.',
        fr: 'Combiner plusieurs comptes d’un même fournisseur (ex. 4 abonnements Google Antigravity) en une seule carte avec les quotas cumulés.',
      },
      default: false,
    },
  ],
}

/**
 * Retrieve OmniRoute settings dynamically from OpenFox PluginContext with env fallbacks.
 */
export function getOmniRouteSettings(context?: PluginContext): OmniRoutePluginSettings {
  const dynamic = context?.settings?.() ?? {}
  const rawBaseUrl = typeof dynamic['baseUrl'] === 'string' ? dynamic['baseUrl'].trim() : ''
  const rawApiKey = typeof dynamic['apiKey'] === 'string' ? dynamic['apiKey'].trim() : ''
  const mergeSubscriptions =
    typeof dynamic['mergeSubscriptions'] === 'boolean'
      ? dynamic['mergeSubscriptions']
      : DEFAULT_SETTINGS.mergeSubscriptions
  const displayedQuotas = (
    typeof dynamic['displayedQuotas'] === 'string' &&
    ['all', 'gemini_claude', 'gemini', 'claude'].includes(dynamic['displayedQuotas'])
      ? dynamic['displayedQuotas']
      : DEFAULT_SETTINGS.displayedQuotas
  ) as DisplayedQuotasOption

  return {
    baseUrl: normalizeBaseUrl(rawBaseUrl || process.env.OMNIROUTE_BASE_URL || DEFAULT_SETTINGS.baseUrl),
    apiKey: rawApiKey || process.env.OMNIROUTE_API_KEY || DEFAULT_SETTINGS.apiKey,
    mergeSubscriptions,
    displayedQuotas,
  }
}
