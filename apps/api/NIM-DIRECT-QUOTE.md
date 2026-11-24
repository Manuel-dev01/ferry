# Direct NIM exchange feasibility check

This operator tool checks whether ChangeHero currently offers a direct exchange from native
NIM to the exact Polygon USDT token used by Ferry. It is not a payment route or an API endpoint.

Obtain a partner API key through [ChangeHero](https://changehero.io/mrkt/changehero-api), then
set `CHANGEHERO_API_KEY` in the API service's private environment or local `.env`. Never put the
key in a frontend variable, screenshot, command argument or committed file.

From the repository root:

```sh
pnpm --filter api check:nim-direct 6000
```

The argument is the proposed NIM amount, with at most five decimal places. The checker reads
enabled asset metadata, verifies the Polygon token contract and six decimals, confirms the forward
pair is enabled for this partner with `getPairs`, reads the current
minimum, and requests an estimated payout only when the amount meets that minimum. Minimums
round up to Luna; estimates round down to USDT base units. Missing or contradictory metadata
fails closed. Provider numbers must be decimal strings.

The checker can call only `getCurrenciesFull`, `getPairs`, `getMinAmount` and `getExchangeAmount`. It never
creates an order, obtains a deposit address, connects a wallet or submits a transaction. A passing
quote establishes neither successful settlement nor a guaranteed final payout. It does not
enable a route in Ferry.

Before implementing payments, verify Nimiq PoS deposits, minimums, fees, refund handling,
recipient-address support, provider eligibility and AML/KYC conditions. A future integrated
flow could request one approved NIM transfer from the connected Nimiq Pay wallet to the
provider and receive Polygon USDT at the user's own address. Such an exchange involves
provider settlement risk and is not the existing self-custodial atomic swap. Pending atomic
swaps must never be silently retried through another provider.
