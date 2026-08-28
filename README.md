# openfox-omniroute-quota

Reports your [OmniRoute](https://omniroute.online) usage/quota to the OpenFox quota modal (the icon to the left of the gear).

The plugin queries the OmniRoute management endpoint `GET /api/usage/quota` on the OmniRoute gateway using a configured API key, then surfaces one card per quota entry as a windowed usage/limit or a token balance.

Defaults (all overridable via environment variables):

- `OMNIROUTE_BASE_URL` — gateway base URL (default `http://localhost:20128`)
- `OMNIROUTE_API_KEY` — API key sent as `Authorization: Bearer`. **A bundled dev key is used as the default** so the plugin works out of the box against a known gateway; set this env var (or pass the key explicitly) to use your own key. Treat the bundled key as a placeholder, not a secret.
- `OMNIROUTE_DASHBOARD_TOKEN` — optional dashboard `auth_token` cookie used as a fallback when the API key lacks the `manage` scope (the `/api/usage/quota` route is management-class)

> The API key and base URL currently default to hardcoded values in `src/quota/omniroute.ts`. A future version will expose them through an OpenFox auth adapter / settings UI.

## Install

Install the package directly into the OpenFox plugin directory, install its runtime dependencies, then restart OpenFox.

### macOS

```bash
PLUGIN_DIR="$HOME/Library/Application Support/openfox/plugins/openfox-omniroute-quota" && mkdir -p "$PLUGIN_DIR" && npx --yes pacote extract openfox-omniroute-quota "$PLUGIN_DIR" && npm install --omit=dev --prefix "$PLUGIN_DIR"
```

Plugin directory:

```text
~/Library/Application Support/openfox/plugins/openfox-omniroute-quota
```

### Linux

```bash
PLUGIN_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/openfox/plugins/openfox-omniroute-quota" && mkdir -p "$PLUGIN_DIR" && npx --yes pacote extract openfox-omniroute-quota "$PLUGIN_DIR" && npm install --omit=dev --prefix "$PLUGIN_DIR"
```

Plugin directory:

```text
${XDG_CONFIG_HOME:-~/.config}/openfox/plugins/openfox-omniroute-quota
```

### Windows PowerShell

```powershell
$dir = Join-Path $env:APPDATA 'openfox\plugins\openfox-omniroute-quota'; New-Item -ItemType Directory -Force $dir | Out-Null; npx --yes pacote extract openfox-omniroute-quota $dir; npm install --omit=dev --prefix $dir
```

Plugin directory:

```text
%APPDATA%\openfox\plugins\openfox-omniroute-quota
```

## Development mode

When OpenFox runs with `OPENFOX_DEV=true`, replace `openfox` with `openfox-dev` in the paths above.

For local plugin development, a symlink is enough (so OpenFox always loads the current build):

```bash
mkdir -p "$HOME/Library/Application Support/openfox-dev/plugins" && ln -sfn /path/to/openfox-omniroute-quota "$HOME/Library/Application Support/openfox-dev/plugins/openfox-omniroute-quota"
```

> **Important:** OpenFox loads `./dist/index.js`, not the `src` files. After editing `src/`, you must run `npm run build` and ensure the `dist/` OpenFox actually loads is the fresh one. With a symlink, `npm run build` in the source repo is enough — no re-copy needed.

Build the plugin before starting OpenFox:

```bash
npm install && npm run build
```

## Quota

Once OpenFox loads the plugin, it reports your OmniRoute quota to the OpenFox quota modal. It calls `GET /api/usage/quota` on the local OmniRoute gateway using the configured API key and surfaces one card per quota entry:

- entries with `used` / `limit` / `window` → a windowed usage/limit card
- entries with `remaining` / `total` → a token-balance card

Results are cached for 60 seconds; if the endpoint is unreachable, the last known values from the current session are shown. If the quota cannot be fetched at all (e.g. an expired or invalid credential, or OmniRoute not running), the card shows a **"Quota unavailable"** entry (0 / 0) instead of real numbers. The card only appears on OpenFox builds that support the `QuotaProvider` contract.

> Note: the `/api/usage/quota` response shape is not formally documented, so the parser is defensive and accepts several plausible shapes (array of quota entries, per-key objects, token-limit objects with `tokensUsed` / `remaining` / `nextResetAt`). If the real response differs, adjust `extractEntries` / `entryToMetric` in `src/quota/omniroute.ts`.

## License

MIT
