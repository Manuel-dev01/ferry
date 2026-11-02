# @ferry/shared

Code that the web app and the API both import, so they can't disagree about a field, an amount or a country.

| File                                 | What                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `schemas.ts`                         | zod schemas for API requests and responses                                                 |
| `payouts.ts`                         | Offer, Lightning invoice and status schemas; M-Pesa Lightning address and receipt helpers  |
| `fonbnk.ts`                          | The 13 countries: currency, payout and top-up methods, minimums, airtime caps, Fonbnk URLs |
| `money.ts`                           | `bigint` base-unit parsing and formatting for USDT (6 decimals), NIM (5) and POL (18)      |
| `normalize.ts`, `accounts.ts`        | Phone number, address and account normalizers                                              |
| `constants.ts`                       | Chain IDs, token addresses and explorer links                                              |
| `quote.ts`, `orders.ts`, `metatx.ts` | Quote math, order states and EIP-712 types for the dormant Paycrest path                   |

Tests live in `test/` and run with `pnpm --filter @ferry/shared test`.
