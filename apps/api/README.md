# Ferry API

The backend for Ferry: Node 22, [Hono](https://hono.dev), [Drizzle ORM](https://orm.drizzle.team) on Postgres, and [viem](https://viem.sh) for Polygon. It fetches quotes, invoices and statuses from payout partners, checks every Lightning invoice, records verified cash-outs for Proof of Ferry, and tops up gas. It never receives user funds.

```sh
cp .env.example .env
pnpm db:up                    # from the repo root: local Postgres in Docker
pnpm --filter api db:migrate
pnpm --filter api dev         # http://localhost:3000
```

| Read                                                         | For                                           |
| ------------------------------------------------------------ | --------------------------------------------- |
| [API reference](../../docs/api.md)                           | Every endpoint, with examples and error codes |
| [Architecture](../../docs/architecture.md)                   | How the API fits into each money flow         |
| [Development guide](../../docs/development.md#configuration) | Every environment variable                    |

| Path               | What                                                              |
| ------------------ | ----------------------------------------------------------------- |
| `src/app.ts`       | Wires dependencies into the routes; error and CORS handling       |
| `src/routes/`      | HTTP endpoints                                                    |
| `src/lightning.ts` | LNURL-pay client and BOLT11 invoice validation                    |
| `src/mpesa.ts`     | M-Pesa delivery status and reconciliation                         |
| `src/payouts.ts`   | Exact conversions and offer ranking                               |
| `src/proof.ts`     | Proof of Ferry statistics                                         |
| `src/db/`          | Schema, client and migration runner; SQL migrations in `drizzle/` |
| `test/`            | Vitest suites; partners and Polygon are faked                     |
