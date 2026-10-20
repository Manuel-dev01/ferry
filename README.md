# Ferry

Move money in and out of [Nimiq Pay](https://nimiq.com). Ferry is a Nimiq Pay Mini App that cashes out USDT and NIM to banks and mobile money in Nigeria, Kenya, Uganda and Tanzania.

> Status: early development. Not ready for real use yet.

## Principles

- **Self-custodial.** Funds go straight from your wallet to the payout rail. Refunds go back to your own address.
- **No gas token needed.** Ferry pays Polygon gas for USDT transfers.
- **See who you're paying** before any money moves.

## Repository layout

| Path              | What                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| `apps/web`        | The Mini App: Vite, Vue 3, TypeScript, UnoCSS with Nimiq's design system |
| `apps/api`        | Backend: Node 22, Hono, Drizzle ORM on Postgres                          |
| `packages/shared` | Shared types, zod schemas, bigint money helpers and constants            |

## Development

Requires Node 22+, pnpm 11 and Docker (for local Postgres).

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm db:up                     # local Postgres
pnpm --filter api db:migrate
pnpm dev                       # web on :5173, API on :3000
```

To try it on a phone: run `pnpm dev`, then open the printed **Network** URL (for example `http://192.168.1.42:5173`) in Nimiq Pay → Mini Apps → Custom URL. The phone must be on the same Wi-Fi.

| Command          | What                                |
| ---------------- | ----------------------------------- |
| `pnpm test`      | Unit and integration tests (Vitest) |
| `pnpm lint`      | ESLint and Prettier                 |
| `pnpm typecheck` | TypeScript in every package         |
| `pnpm build`     | Production builds                   |

## Security

Secrets live only in server environment variables. The web app talks to wallets only through Nimiq Pay's providers (`@nimiq/mini-app-sdk` and `window.ethereum`) and never sees keys. Report vulnerabilities privately through GitHub's security advisories.

## License

[MIT](LICENSE)
