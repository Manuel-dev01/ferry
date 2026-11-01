# Ferry

Cash out USDT or NIM from [Nimiq Pay](https://nimiq.com) to banks, mobile money and airtime in 13 countries, and add money the other way. Ferry is a Nimiq Pay Mini App: open it inside Nimiq Pay, compare offers, approve once, and watch the money land.

**Live:** [ferry-beta.vercel.app](https://ferry-beta.vercel.app) (open it in Nimiq Pay → Mini Apps; on a computer it shows the landing page) · **Proof of Ferry:** [ferry-beta.vercel.app/proof](https://ferry-beta.vercel.app/proof)

## What it does

| Feature                                                                                                                                                                  | How                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cash out** to banks and mobile money in Nigeria, Kenya, Ghana, South Africa, Uganda, Tanzania, Rwanda, Zambia, The Gambia, Senegal, Côte d'Ivoire, Cameroon and Brazil | Ferry asks each payout partner for a live quote and shows a **Select offer** screen with what arrives; the best one is marked Recommended                                                                   |
| **M-Pesa Direct** (Kenya)                                                                                                                                                | Every Kenyan phone number has a Lightning address. Ferry fetches the invoice, Nimiq Pay pays it with NIM or USDT in one approval, and Ferry shows the M-Pesa receipt when it lands, usually within a minute |
| **Mavapay Money** (Nigeria, Kenya, South Africa)                                                                                                                         | The user's own Mavapay Money Lightning address pays out to their linked bank: one screen, NIM or USDT                                                                                                       |
| **Fonbnk** (all 13 countries)                                                                                                                                            | Fonbnk's hosted form runs inside Ferry; Ferry then sends the USDT to Fonbnk's deposit address with one approval                                                                                             |
| **Cash out NIM**                                                                                                                                                         | NIM → Lightning → USDT in the user's own wallet through LendaSwap, an atomic swap; then cash out as usual                                                                                                   |
| **Buy airtime** in 11 countries, **pay a Kenyan till or Paybill**                                                                                                        | The same sell flow with a different payout method                                                                                                                                                           |
| **Add money** in 6 countries                                                                                                                                             | Fonbnk's buy flow, embedded; Ferry watches the balance and shows the USDT when it lands                                                                                                                     |
| **Proof of Ferry**                                                                                                                                                       | Public numbers built only from what Ferry can prove: USDT transfers to Fonbnk seen on Polygon, and M-Pesa receipts                                                                                          |

## Principles

- **Self-custodial.** The user's wallet pays the payout partner directly. Ferry never holds funds and never sees a key; every approval happens in Nimiq Pay (`@nimiq/mini-app-sdk` and `window.ethereum`).
- **Approve once.** One deliberate tap, one approval. Nothing asks for approval on page load.
- **Never pay twice.** A duplicate or uncertain payment is never retried; Ferry reads the status first.
- **Honest numbers.** Quotes come from the partners. Where Ferry estimates (Lightning routes, whose swap fee Nimiq Pay shows at approval), the amount is marked ≈.
- **No gas token needed.** For USDT transfers, Ferry tops up a little POL for the fee, within daily limits.

## How a cash-out flows

```
Nimiq Pay wallet ──(one approval: USDT or NIM)──▶ payout partner ──▶ bank / mobile money / airtime
        ▲                                                │
        └──────── Ferry: quotes, invoices, status ◀──────┘   (Ferry never touches the money)
```

## Repository layout

| Path              | What                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | The Mini App and landing page: Vite, Vue 3, TypeScript, Pinia, vue-i18n, UnoCSS (layout only) and Ferry's own design tokens                                   |
| `apps/api`        | Backend: Node 22, Hono, Drizzle ORM on Postgres, viem. Fetches quotes, invoices and statuses from partners; records hand-offs for Proof of Ferry; tops up gas |
| `packages/shared` | Shared zod schemas, bigint money helpers, partner and country definitions                                                                                     |

## Development

Requires Node 22+, pnpm 11 and Docker (for local Postgres).

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm db:up                     # local Postgres
pnpm --filter api db:migrate
pnpm dev                       # web on :5173, API on :3000
```

Set `VITE_MOCK_WALLET=true` for the web app to run the whole flow in a desktop browser with a mock wallet. It approves nothing real and broadcasts nothing. To try it on a phone, open the printed **Network** URL in Nimiq Pay → Mini Apps → Custom URL (same Wi-Fi).

| Command          | What                                |
| ---------------- | ----------------------------------- |
| `pnpm test`      | Unit and integration tests (Vitest) |
| `pnpm lint`      | ESLint and Prettier                 |
| `pnpm typecheck` | TypeScript in every package         |
| `pnpm build`     | Production builds                   |

## Partners

Ferry uses public, keyless interfaces only:

- [Fonbnk](https://fonbnk.com) (hosted on/off-ramp widget and quotes)
- [Tando](https://tando.me) (M-Pesa Lightning addresses and receipts)
- [Mavapay](https://mavapay.co) (Mavapay Money Lightning addresses, public prices)
- [LendaSwap](https://lendasat.com) (Lightning ↔ Polygon USDT atomic swaps)

Each partner provides its service under its own terms. Ferry is not affiliated with them.

## Security

Secrets live only in server environment variables. Report vulnerabilities privately through GitHub's security advisories.

## License

[MIT](LICENSE)
