# openfox-omniroute-quota

Reports your [OmniRoute](https://omniroute.online) usage and quotas to OpenFox via the **`openfox-quota`** plugin.

This plugin queries OmniRoute management endpoints (`/api/usage/provider-limits` and `/api/usage/quota`) on your OmniRoute gateway and registers standard quota providers and stats directly into OpenFox.

---

## Features

- **OpenFox v2 Plugin API**: Built on the native OpenFox v2 Plugin Registry (`openfox/plugin`).
- **Declarative Settings**: Configure OmniRoute Server URL and API Key directly in OpenFox Settings (Plugins tab).
- **`openfox-quota` Integration**: Registers quota providers (`QuotaProvider`) into OpenFox's unified Quota Modal, supporting windowed rate limits (hour, week, month) and token pools.
- **Auto-Sync on Turn**: Keeps quota metrics refreshed automatically on turn completion.
- **LLM Tool & RPC Endpoints**: Provides `get_omniroute_quota` tool for agents and `omniroute.getQuota` / `omniroute.syncQuota` RPC methods.

---

## Configuration

Settings can be configured in OpenFox UI under **Settings → Plugins → OmniRoute Quota**, or via environment variables:

| Setting | Env Variable | Default | Description |
|---|---|---|---|
| `baseUrl` | `OMNIROUTE_BASE_URL` | `http://localhost:20128` | OmniRoute gateway base URL |
| `apiKey` | `OMNIROUTE_API_KEY` | `""` | OmniRoute API key |

---

## Build and Test

```bash
cd tmp/openfox-plugins/openfox-omniroute-quota
npm run build
npm run test
npm run typecheck
```

---

## License

MIT
