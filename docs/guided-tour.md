# Guided tour

A ten-minute path through Ferry for reviewers and judges: what to open, what you should see, and which code backs each claim.

## Contents

1. [See it (3 minutes)](#1-see-it-3-minutes)
2. [Use it in Nimiq Pay (3 minutes)](#2-use-it-in-nimiq-pay-3-minutes)
3. [Read the code that matters (4 minutes)](#3-read-the-code-that-matters-4-minutes)
4. [Check the claims yourself](#4-check-the-claims-yourself)

## 1. See it (3 minutes)

No wallet needed.

| Open                                                                                                                                        | What to look for                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [ferry-beta.vercel.app](https://ferry-beta.vercel.app)                                                                                      | The landing page: the 13 countries, how a cash-out works, and live numbers from Proof of Ferry                                            |
| [ferry-beta.vercel.app/proof](https://ferry-beta.vercel.app/proof)                                                                          | Real cash-outs. Each row links to its evidence: a Polygonscan transaction or an M-Pesa receipt                                            |
| [API: live offers for 5 USDT to M-Pesa](https://api-production-5835.up.railway.app/v1/offers?country=KE&channel=mobile_money&units=5000000) | The JSON behind the **Select offer** screen: one offer per partner, one marked `recommended`, Lightning estimates marked `estimate: true` |

## 2. Use it in Nimiq Pay (3 minutes)

Open **Nimiq Pay → Mini Apps → Custom URL → `ferry-beta.vercel.app`**.

| Step | Tap                                                    | You should see                                                                                                             |
| ---- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open Ferry                                             | Your NIM and USDT balances and an estimate in your local currency. **No approval dialog appears on load.**                 |
| 2    | **Cash out** → a country → a payout method → an amount | **Select offer**: each partner's amount, rate and fee, with one marked **Recommended**                                     |
| 3    | Pick **M-Pesa Direct** (Kenya)                         | One screen: phone number, amount, and what arrives. One approval in Nimiq Pay, paid with NIM or USDT                       |
| 4    | Pick **Fonbnk** (any country)                          | Fonbnk's form inside Ferry, then a **Send** step: connect, switch to Polygon if needed, send. Each approval is its own tap |
| 5    | **Cash out NIM** from the home screen                  | A NIM → USDT swap into your own wallet, with the swap fee shown before you approve                                         |
| 6    | **History**                                            | Every cash-out with its status and receipt. Open one to resume checking                                                    |

Real money moves from step 3 on. Each partner's minimum is shown before you approve. To explore without money, run Ferry locally with the [mock wallet](development.md#desktop-development-with-the-mock-wallet).

## 3. Read the code that matters (4 minutes)

Read these in order. Each one backs a specific promise.

| #   | File                                                                                                                       | The promise it keeps                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [`apps/web/src/providers/`](../apps/web/src/providers)                                                                     | **Self-custody.** The only code that talks to the wallet: `@nimiq/mini-app-sdk` and `window.ethereum`. No keys, no seed phrases.                                  |
| 2   | [`apps/api/src/routes/payouts.ts`](../apps/api/src/routes/payouts.ts) → `GET /offers`                                      | **Compare, then cross.** Quotes from every partner in parallel; one failing partner never hides the rest.                                                         |
| 3   | [`apps/api/src/lightning.ts`](../apps/api/src/lightning.ts) → `validateInvoice`                                            | **Check before you pay.** Each invoice is checked for network, exact amount, LNURL description hash and remaining lifetime before the user sees it.               |
| 4   | [`apps/web/src/views/cashout/LightningPayoutView.vue`](../apps/web/src/views/cashout/LightningPayoutView.vue)              | **Never lose a payment.** The history entry is saved as "awaiting" before the wallet pays; an unclear result checks status instead of paying again.               |
| 5   | [`apps/web/src/views/cashout/FonbnkView.vue`](../apps/web/src/views/cashout/FonbnkView.vue) → `send`, `sendUncertain`      | **One tap, one approval; never pay twice.** Connect, network switch and send are separate taps; after an uncertain send, Send stays locked until the user checks. |
| 6   | [`apps/web/src/lib/nimSwap.ts`](../apps/web/src/lib/nimSwap.ts)                                                            | **Cash out NIM safely.** An atomic swap whose secret lives only on the device: it completes, or the NIM comes back.                                               |
| 7   | [`apps/api/src/routes/handoffs.ts`](../apps/api/src/routes/handoffs.ts) → `directUsdtTransfer`, `POST /gas`                | **Honest proof, no gas token.** Only a real, recent, direct USDT transfer is recorded; gas top-ups are capped and recorded before broadcast.                      |
| 8   | [`apps/api/src/proof.ts`](../apps/api/src/proof.ts)                                                                        | **Numbers you can check.** A pure function from verified rows to public statistics, with its own tests.                                                           |
| 9   | [`packages/shared/src/money.ts`](../packages/shared/src/money.ts), [`apps/api/src/payouts.ts`](../apps/api/src/payouts.ts) | **Exact money.** `bigint` base units and integer conversions, rounded in the user's favour.                                                                       |

For the full picture, including a sequence diagram for every flow, read the [architecture doc](architecture.md).

## 4. Check the claims yourself

```sh
git clone https://github.com/Manuel-dev01/ferry.git && cd ferry
pnpm install
pnpm test          # 147 tests, no network or wallet needed
pnpm typecheck && pnpm lint
```

- **Proof of Ferry is real:** open any Polygonscan link on `/proof`. The transaction is a USDT transfer from a user's wallet to a payout partner, never through a Ferry address.
- **Ferry never holds funds:** search the web app for wallet calls (`eth_sendTransaction`, `payLightningInvoice`). Every recipient is a partner's deposit address or invoice.
- **Secrets stay on the server:** `apps/web/.env.example` lists every variable the web app reads; none is a secret.
