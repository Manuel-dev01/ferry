# Ferry web app

The Nimiq Pay Mini App and the public landing page: Vite, Vue 3, TypeScript, Pinia, vue-i18n and UnoCSS.

```sh
pnpm --filter web dev         # http://localhost:5173, also reachable from a phone on the same Wi-Fi
```

Set `VITE_MOCK_WALLET=true` in `.env.local` to run every screen in a desktop browser with a fake wallet. See the [development guide](../../docs/development.md) for phone testing and configuration.

| Path               | What                                                                              |
| ------------------ | --------------------------------------------------------------------------------- |
| `src/views/`       | One component per screen; `cashout/` holds the cash-out flows                     |
| `src/providers/`   | The only code that talks to the wallet (`@nimiq/mini-app-sdk`, `window.ethereum`) |
| `src/stores/`      | Session, cash-out draft and on-device history                                     |
| `src/lib/`         | API client, NIM swap, formatting and friendly errors                              |
| `src/i18n/en.json` | Every user-facing string                                                          |
| `src/styles/`      | Ferry's design tokens and components                                              |
| `src/dev/`         | The mock wallet (development builds only)                                         |
