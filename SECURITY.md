# Security policy

Ferry moves real money on Polygon mainnet and over Lightning, so security reports are very welcome.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository. Don't open a public issue for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply within a few days.

## What's in scope

- The web app (`apps/web`) and the API (`apps/api`) in this repository
- The live deployment at `ferry-beta.vercel.app` and its API

Issues in Nimiq Pay or in a payout partner's own service belong with that project, but tell us too if they affect Ferry users.

## What matters most

- Anything that could make a user pay the wrong recipient or the wrong amount
- Anything that could make Ferry pay twice, or hide a payment that happened
- Bypassing the gas top-up limits, or draining the relayer
- Inflating Proof of Ferry with payouts that didn't happen
- Leaking a secret or a user's personal data

## How Ferry is built to be safe

Ferry never holds user funds and never sees a key: the user's wallet pays the partner directly, after an approval in Nimiq Pay. The server's only hot wallet holds a little POL for gas. See [Architecture → Security and trust model](docs/architecture.md#8-security-and-trust-model) for the details.
