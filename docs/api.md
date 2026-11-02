# API reference

The Ferry API is a small JSON-over-HTTPS service in `apps/api`. The Mini App is its only intended client, but every endpoint is public and read-mostly, and none needs authentication.

- **Production:** `https://api-production-5835.up.railway.app`
- **Local:** `http://localhost:3000`

Request and response shapes are defined once, as zod schemas in [`packages/shared/src`](../packages/shared/src), and both the API and the web app import them. The tables below summarize them; the schemas are the source of truth.

## Contents

- [Conventions](#conventions)
- [Health](#health)
- [Offers](#offers)
- [M-Pesa Direct](#m-pesa-direct)
- [Mavapay Money](#mavapay-money)
- [Fonbnk hand-offs](#fonbnk-hand-offs)
- [Gas top-up](#gas-top-up)
- [Wallet and app data](#wallet-and-app-data)
- [Proof of Ferry](#proof-of-ferry)
- [Dormant: Paycrest](#dormant-paycrest)
- [Error codes](#error-codes)

## Conventions

| Topic         | Rule                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Token amounts | Strings of integer **base units**: USDT has 6 decimals, so `"5000000"` is 5 USDT. POL amounts are in wei (18 decimals).                       |
| Fiat amounts  | Decimal strings in whole currency units (`"6831"`), unless a field says otherwise.                                                            |
| Times         | Unix seconds for invoice expiry; Unix milliseconds for `at` and `updatedAt` fields.                                                           |
| Hashes        | Polygon transaction hashes are `0x`-prefixed hex. Lightning payment hashes are 64 lowercase hex characters, no prefix.                        |
| Errors        | `{"error": {"code": "…", "message": "…", "ref": "…"}}` with an HTTP status. `ref` is a support reference that also appears in the server log. |
| CORS          | Only origins listed in `CORS_ORIGINS` (plus private-network origins in development).                                                          |

## Health

| Method and path | Response                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /health`   | `{"ok": true}`: the process is up. Used by Railway's health check.                                             |
| `GET /ready`    | `{"ok": bool, "checks": {"db", "rpc", "paycrest"}}`, each `ok`, `fail` or `skipped`. `503` if any check fails. |

## Offers

### `GET /v1/offers`

Live offers for one cash-out, ranked, with exactly one marked `recommended`.

| Query     | Example        | Notes                                                                                   |
| --------- | -------------- | --------------------------------------------------------------------------------------- |
| `country` | `KE`           | One of the 13 country codes in `FONBNK_COUNTRIES`                                       |
| `channel` | `mobile_money` | `bank`, `mobile_money`, `paybill`, `buy_goods` or `airtime`, as offered in that country |
| `units`   | `5000000`      | USDT base units                                                                         |

```json
{
  "offers": [
    {
      "route": "mpesa_ln",
      "receive": "635",
      "currency": "KES",
      "rate": "127.00",
      "fee": null,
      "estimate": true,
      "recommended": true
    },
    {
      "route": "fonbnk",
      "receive": "614",
      "currency": "KES",
      "rate": "125.92",
      "fee": "15",
      "estimate": false,
      "recommended": false
    }
  ]
}
```

A real response from 2 November 2026; rates move. `route` is `fonbnk`, `mpesa_ln` or `mavapay_ln`. `estimate: true` means Ferry calculated the amount; it includes an allowance for Nimiq Pay's swap fee, which the wallet shows at approval. A partner that fails to answer is left out rather than failing the request.

## M-Pesa Direct

### `POST /v1/ln/mpesa`

Gets a Lightning invoice from the Kenyan number's own Lightning address, sized so the recipient gets `kes` shillings after Tando's fee.

```json
{ "phone": "0712345678", "kes": 500 }
```

Response (`lnInvoiceResponseSchema`):

| Field         | Meaning                                                                            |
| ------------- | ---------------------------------------------------------------------------------- |
| `invoice`     | BOLT11 invoice, already validated (network, amount, description hash, ≥ 60 s left) |
| `paymentHash` | Use it to check status                                                             |
| `sats`        | Invoice amount in satoshis                                                         |
| `expiresAt`   | Unix seconds                                                                       |
| `receive`     | Shillings the recipient should get                                                 |
| `currency`    | `KES`                                                                              |

The phone number is used to build the Lightning address and is not stored.

### `GET /v1/ln/mpesa/:paymentHash`

Delivery status from Tando.

| Field     | Meaning                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `status`  | `pending`, `completed`, `failed`, or `unknown` (Tando unreachable or doesn't know the hash yet)         |
| `paid`    | Tando has received the Lightning payment. An issued but unpaid invoice is `pending` with `paid: false`. |
| `receipt` | M-Pesa confirmation code, once delivered                                                                |
| `kes`     | Shillings delivered, when known                                                                         |

## Mavapay Money

### `POST /v1/ln/mavapay`

```json
{ "address": "amara@mavapay.money", "units": "5000000" }
```

Returns the same shape as M-Pesa Direct. The address must be on `mavapay.money`. The invoice is sized from Mavapay's own BTC price for the account's currency.

### `GET /v1/ln/mavapay/:paymentHash`

`{"status": "pending" | "paid" | "unknown"}`, read from the invoice's LUD-21 verify link. `unknown` means Mavapay gave no verify link or it couldn't be read.

## Fonbnk hand-offs

A hand-off is the USDT transfer from the user's wallet to Fonbnk's deposit address. Ferry records it only after checking the transaction on Polygon.

### `POST /v1/handoffs`

```json
{ "txHash": "0x…", "provider": "fonbnk", "country": "NG", "channel": "bank" }
```

| Status | Body                                                            | When                                                                                 |
| ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `200`  | `{"status": "confirmed", "txHash", "amountUnits", "toAddress"}` | A successful, direct USDT transfer from the sender's own wallet, under 3 days old    |
| `202`  | `{"status": "pending", "amountUnits": null, "toAddress": null}` | Not mined yet; call again                                                            |
| `200`  | `{"status": "reverted", …}`                                     | The transaction failed on-chain                                                      |
| `400`  | `NOT_A_TRANSFER`, `TOO_OLD`, `INVALID_REQUEST`                  | Not a direct USDT transfer, too old, or the country doesn't offer that payout method |

Idempotent: posting the same `txHash` again returns the stored record.

### `POST /v1/handoffs/:txHash/received`

The sender confirms the payout arrived. The first confirmation within 7 days is kept; later ones return the stored record.

### `GET /v1/handoffs/:txHash`

The stored record, or `404`.

## Gas top-up

### `POST /v1/gas`

```json
{ "address": "0x…" }
```

Sends just enough POL for one USDT transfer to a wallet that holds USDT but not enough POL.

| `status`         | Meaning                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `already_funded` | The wallet already has enough POL; nothing sent                              |
| `sent`           | Mined successfully (`txHash` included)                                       |
| `pending`        | Broadcast, not mined within 60 s (`202`)                                     |
| `reverted`       | Mined but failed                                                             |
| `unknown`        | The broadcast outcome is unclear (`202`). Ferry never re-sends in this case. |

Errors: `404 GAS_TOPUP_DISABLED`, `400 NOTHING_TO_SEND` (no USDT to cash out), `429 GAS_LIMIT` (per-wallet or daily cap), `429 GAS_BUSY` (another top-up in flight), `503 GAS_UNAVAILABLE`.

## Wallet and app data

| Method and path             | Response                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/balances/:address` | `{"address", "usdt", "pol"}` in base units, read from Polygon. `503 RPC_UNAVAILABLE` if every RPC fails.                               |
| `GET /v1/meta`              | What the web app needs at startup: `payoutRoute`, whether `gasTopup` is available, limits, and settings for the dormant Paycrest path. |

## Proof of Ferry

### `GET /v1/stats`

Public usage numbers, cached for 30 seconds (`statsResponseSchema`).

| Field                        | Meaning                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `cashouts`                   | Verified Fonbnk hand-offs plus delivered M-Pesa Direct payouts                                                            |
| `confirmedPaid`              | Cash-outs confirmed delivered (M-Pesa receipt, or the sender's "It arrived")                                              |
| `uniqueWallets`, `countries` | Distinct sending wallets (on-chain senders only; a Lightning payment doesn't reveal the wallet) and destination countries |
| `volumeUnits`                | Total USDT base units                                                                                                     |
| `medianSeconds`              | Median send-to-delivery time over timed deliveries (2 days at most); `null` until there is one                            |
| `byCountry[]`                | `{country, cashouts, volumeUnits}`                                                                                        |
| `latest[]`                   | `{country, channel, amountUnits, route, link, at, seconds}`; `link` is the Polygonscan transaction or M-Pesa receipt      |
| `updatedAt`                  | Unix milliseconds                                                                                                         |

## Dormant: Paycrest

These endpoints serve the Paycrest cash-out path, which runs against a simulated order engine and is switched off in production (`PAYOUT_ROUTE=fonbnk`). See [Architecture → Dormant paths](architecture.md#11-dormant-paths).

| Method and path                  | Purpose                                               |
| -------------------------------- | ----------------------------------------------------- |
| `GET /v1/institutions/:currency` | Banks and mobile money providers (live from Paycrest) |
| `GET /v1/quote`                  | Rate and amounts for NGN, KES, UGX or TZS             |
| `POST /v1/accounts/verify`       | Account name lookup (simulated)                       |
| `POST /v1/orders/offramp`        | Create an order; returns the EIP-712 data to sign     |
| `POST /v1/orders/:id/signature`  | Submit the `eth_signTypedData_v4` signature           |
| `GET /v1/orders/:id`             | Order status (needs the `X-Client-Secret` header)     |

## Error codes

| HTTP  | Codes                                                                                                                                                                                                                                    |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400` | `INVALID_REQUEST`, `INVALID_PHONE`, `INVALID_AMOUNT`, `LN_BAD_ADDRESS`, `NOT_A_TRANSFER`, `TOO_OLD`, `NOTHING_TO_SEND`, `OUTSIDE_LIMITS`                                                                                                 |
| `404` | `NOT_FOUND`, `GAS_TOPUP_DISABLED`                                                                                                                                                                                                        |
| `429` | `GAS_LIMIT`, `GAS_BUSY`                                                                                                                                                                                                                  |
| `502` | A partner misbehaved. `PARTNER_HTTP_ERROR`, `LNURL_*` (unreachable, error, bad response, insecure, no currency), and invoice checks: `LN_BAD_INVOICE`, `LN_WRONG_NETWORK`, `LN_AMOUNT_MISMATCH`, `LN_DESCRIPTION_MISMATCH`, `LN_EXPIRED` |
| `503` | `DB_UNAVAILABLE`, `RPC_UNAVAILABLE`, `GAS_UNAVAILABLE`                                                                                                                                                                                   |
| `500` | `INTERNAL` (details only in the server log, under `ref`)                                                                                                                                                                                 |

The dormant Paycrest endpoints add `INVALID_ACCOUNT`, `ACCOUNT_NOT_FOUND`, `UNKNOWN_INSTITUTION`, `CORRIDOR_PAUSED`, `NAME_CHECK_UNAVAILABLE`, `ORDER_*` and `METATX_*` codes.
