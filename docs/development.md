# Development guide

How to set up Ferry, configure it, test it on a phone, change it safely, and deploy it.

## Contents

- [Prerequisites](#prerequisites)
- [First run](#first-run)
- [Desktop development with the mock wallet](#desktop-development-with-the-mock-wallet)
- [Test on a phone](#test-on-a-phone)
- [Configuration](#configuration)
- [Database and migrations](#database-and-migrations)
- [Tests and checks](#tests-and-checks)
- [Common changes](#common-changes)
- [Deploy](#deploy)
- [Rules for changes that touch money](#rules-for-changes-that-touch-money)

## Prerequisites

| Tool    | Version | Why                                                                                         |
| ------- | ------- | ------------------------------------------------------------------------------------------- |
| Node.js | 22+     | Runtime for the API and the build tools                                                     |
| pnpm    | 11      | Workspace package manager (`corepack enable` installs the version pinned in `package.json`) |
| Docker  | any     | Local Postgres via `docker compose`                                                         |

For phone testing you also need **Nimiq Pay** on a phone on the same Wi-Fi as your computer.

## First run

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm db:up                       # Postgres 17 on localhost:5432 (user, password, db: ferry)
pnpm --filter api db:migrate
pnpm dev                         # web on :5173 and API on :3000, in parallel
```

Open <http://localhost:5173>. In a normal browser you see the landing page, because wallet screens need Nimiq Pay. Use the mock wallet (next section) or a phone to see the app itself.

## Desktop development with the mock wallet

Create `apps/web/.env.local`:

```sh
VITE_MOCK_WALLET=true
```

Restart `pnpm dev`. The app now behaves as if it were inside Nimiq Pay: it has fake NIM and Polygon accounts and shows a **mock approval sheet** for every wallet request, so you can approve or reject and see each path. It never signs or broadcasts anything real.

- Add `?fiat=KES` (or another currency) to the URL to start with that country's defaults.
- The mock is compiled in only for development builds (`import.meta.env.DEV`), so it can't ship to production even if the variable is set.

## Test on a phone

1. Run `pnpm dev`. Vite prints a **Network** URL such as `http://192.168.1.20:5173`.
2. On the phone, open **Nimiq Pay → Mini Apps → Custom URL** and enter that URL.
3. The app talks to the API at the same host on port `3000`. In development the API accepts requests from private-network origins automatically, so no CORS change is needed.

This uses real wallets and real money. Start with the smallest amounts each partner allows.

## Configuration

### API (`apps/api/.env`)

Every variable is validated at startup by [`apps/api/src/env.ts`](../apps/api/src/env.ts). An invalid value stops the server with a message naming the variable, never its value.

| Variable                                                                    | Default                   | Purpose                                                                           |
| --------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                  | `development`             | `production` requires `DATABASE_URL`                                              |
| `PORT`, `HOST`, `LOG_LEVEL`                                                 | `3000`, `0.0.0.0`, `info` | Server basics                                                                     |
| `DATABASE_URL`                                                              | none                      | Postgres connection string. Without it, endpoints that need storage answer `503`. |
| `DATABASE_URL_UNPOOLED`                                                     | none                      | Optional direct connection for migrations (useful with Neon's pooler)             |
| `CORS_ORIGINS`                                                              | none                      | Comma-separated web origins allowed to call the API                               |
| `PUBLIC_WEB_ORIGIN`                                                         | none                      | The web app's public origin                                                       |
| `POLYGON_RPC_URLS`                                                          | two public RPCs           | Comma-separated, tried in order                                                   |
| `USDT0_ADDRESS`                                                             | Polygon USDT0             | Token contract                                                                    |
| `RELAYER_PRIVATE_KEY`                                                       | none                      | **Secret.** Hot wallet that pays POL for gas top-ups. Keep its balance small.     |
| `PAYOUT_ROUTE`                                                              | `fonbnk`                  | `fonbnk` in production; `paycrest` enables the dormant path                       |
| `GAS_TOPUP_ENABLED`                                                         | `false`                   | Turn on gas top-ups (needs the relayer key and a database)                        |
| `GAS_TOPUP_CAP_POL`                                                         | `0.3`                     | Most POL a wallet can be topped up to                                             |
| `GAS_TOPUP_PER_ADDRESS_DAY`, `GAS_TOPUP_DAILY_MAX`                          | `0`, `0`                  | Optional caps per wallet and in total per 24 hours; `0` means no cap              |
| `PROOF_EXCLUDE_ADDRESSES`                                                   | none                      | Wallets left out of Proof of Ferry (for example, test wallets)                    |
| `LIMIT_MIN_USD`, `LIMIT_MAX_USD`, `LIMIT_DAILY_USD`                         | `1`, `200`, `500`         | Amount limits; the minimum also decides who qualifies for gas                     |
| `PAYCREST_*`, `FERRY_FEE_PERCENT`, `CORRIDORS_ENABLED`, `ALLOW_MOCK_ORDERS` | see `.env.example`        | Dormant Paycrest path only                                                        |

### Web (`apps/web/.env.local`)

Everything here is compiled into the public bundle. **Never put a secret in a `VITE_` variable.**

| Variable             | Purpose                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`       | API base URL. Empty in development uses the page's host on port 3000. Required public HTTPS URL for production builds; missing configuration fails the build. |
| `VITE_PUBLIC_ORIGIN` | Public origin, used for "Open in Nimiq Pay" links                                                                                                             |
| `VITE_MOCK_WALLET`   | `true` for the desktop mock wallet (development builds only)                                                                                                  |
| `VITE_SENTRY_DSN`    | Optional error reporting                                                                                                                                      |

## Database and migrations

The schema is in [`apps/api/src/db/schema.ts`](../apps/api/src/db/schema.ts) (Drizzle ORM). Migrations are SQL files in [`apps/api/drizzle/`](../apps/api/drizzle).

```sh
# after editing schema.ts
pnpm --filter api db:generate    # writes a new numbered SQL migration
pnpm --filter api db:migrate     # applies pending migrations
```

Migrations are additive and run automatically when the production container starts. Review the generated SQL before committing it.

## Tests and checks

```sh
pnpm test         # all Vitest suites
pnpm lint         # ESLint + Prettier check (pnpm format fixes formatting)
pnpm typecheck    # tsc and vue-tsc
VITE_API_URL=https://api-production-5835.up.railway.app pnpm build # production builds (bash)
```

| Package           | What the tests cover                                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared` | Money parsing and formatting, normalizers, country and channel rules, Fonbnk URL builders, quote math                                                                                                           |
| `apps/api`        | Every route against fakes (no network), LNURL and BOLT11 validation (including a real invoice), Tando invoice sizing, hand-off verification, Proof of Ferry statistics, meta-transaction checks, env validation |
| `apps/web`        | Wallet provider error classification and Lightning result parsing                                                                                                                                               |

API tests use an injected `fetch` and in-memory fakes, so they never call partners or Polygon. CI runs lint, typecheck, test and build on every push and pull request.

## Common changes

**Add or change a country.** Countries are data, in `FONBNK_COUNTRIES` in [`packages/shared/src/fonbnk.ts`](../packages/shared/src/fonbnk.ts): currency, name, payout methods (`cashout`), top-up methods (`topup`), minimum, and optional airtime caps. Flags are generated from the country code. If a payout method has a local name (like M-Pesa in Kenya), add it under `fonbnk.channelsByCountry` in [`apps/web/src/i18n/en.json`](../apps/web/src/i18n/en.json). Then run `pnpm test`: the shared tests check every country's rules.

**Add a payout partner.** Add a route name to `payoutRouteSchema` in `packages/shared/src/payouts.ts`, add its quote to `GET /v1/offers` in `apps/api/src/routes/payouts.ts` (wrapped so a failure only drops that offer), and handle the new route in the offer picker in `FonbnkView.vue`. Keep the rules in [the last section](#rules-for-changes-that-touch-money).

**Change copy.** Every user-facing string is in `apps/web/src/i18n/en.json`, with translations in `fr.json`, `pt.json` and `sw.json`. A new string needs all four: `apps/web/test/i18n.test.ts` fails if a live screen's string is missing in a language or a translation drops a `{placeholder}`. The app picks the language from Nimiq Pay (`pt-BR` counts as `pt`), and Settings can override it.

## Deploy

| Part     | Where   | How                                                                                                                                                                   |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API      | Railway | Builds the root `Dockerfile` (see `railway.json`). Set the API variables above in Railway; the container migrates the database, then starts. Health check: `/health`. |
| Web      | Vercel  | Build `apps/web` with `VITE_API_URL` set to the API's public URL and deploy `apps/web/dist` as a static site.                                                         |
| Database | Neon    | Any Postgres 15+ works. Put the pooled URL in `DATABASE_URL` and, optionally, the direct URL in `DATABASE_URL_UNPOOLED`.                                              |

After deploying, add the web origin to the API's `CORS_ORIGINS`.

## Rules for changes that touch money

These rules are why Ferry is safe to use. Please keep them in any change:

1. **Wallet access only through `apps/web/src/providers/`.** Never ask for a private key or seed phrase.
2. **One tap, one approval.** No approval on page load, and never two approvals back to back without a screen in between.
3. **Structured signatures use `eth_signTypedData_v4`**, never `personal_sign`.
4. **Never retry a payment automatically.** On an unclear outcome, check the status, then ask the user.
5. **Write the record before paying or broadcasting**, so a crash can't lose track of money in flight.
6. **Money is `bigint` base units**; fiat is decimal strings. No floats for amounts.
7. **Secrets only in server environment variables**, never in the web bundle or logs.
