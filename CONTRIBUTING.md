# Contributing

Thanks for helping improve Ferry.

1. **Set up** with the [development guide](docs/development.md). The mock wallet lets you work on every screen without real money.
2. **Open an issue first** for anything larger than a small fix, so we can agree on the approach.
3. **Keep the money rules.** Any change that touches payments follows the [rules for changes that touch money](docs/development.md#rules-for-changes-that-touch-money).
4. **Check before you push:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. CI runs the same checks.
5. **Write for people.** User-facing text lives in `apps/web/src/i18n/`; keep it short and plain, and add each new string in all four languages (the tests check).

Security problems: please follow [SECURITY.md](SECURITY.md) instead of opening an issue.

By contributing, you agree your work is released under the [MIT License](LICENSE).
