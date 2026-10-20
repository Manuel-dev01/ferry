# Ferry API

Node 22 + Hono + Drizzle (Postgres). Runs continuously: it relays gasless transfers and polls payout status.

```sh
cp .env.example .env
pnpm db:up               # from the repo root: local Postgres in Docker
pnpm --filter api db:migrate
pnpm --filter api dev    # http://0.0.0.0:3000
```

| Route                       | What                                                         |
| --------------------------- | ------------------------------------------------------------ |
| `GET /health`               | Liveness                                                     |
| `GET /ready`                | Database, Polygon RPC and Paycrest reachability              |
| `GET /v1/balances/:address` | USDT and POL balance on Polygon, as base-unit strings        |
| `/spike/*`                  | Phase 0 experiments, mounted only with `SPIKES_ENABLED=true` |

Secrets live only in environment variables. Logs redact signatures, account details, phone numbers and keys.
