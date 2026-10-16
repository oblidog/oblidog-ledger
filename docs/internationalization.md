# Internationalization

The foundation supports English (`en`) and Polish (`pl`). Full screen extraction,
API error localization, and email localization are tracked in #512, #513, and
#514. Some screens intentionally remain English until those changes land.

## Language resolution

- Normal signed-in account: saved `User.language`, then the first supported
  browser language, then English. A null preference means no explicit choice.
- Anonymous pages: locally selected language, then browser language, then English.
- Shared public demo: the same browser-local rules as anonymous pages. Never
  write a preference to the shared account.
- Regional browser tags such as `pl-PL` and `en-US` resolve to their base language.
- The anonymous/demo choice is stored as `oblidog-language` in localStorage.
  Blocked storage does not prevent an in-memory selection.
- A successful account update refreshes the `currentUser` query. A failed update
  keeps the previous language and shows a localized error. Signing out restores
  the local/browser choice; signing in applies the account preference.
- The selector waits for public configuration before saving an account choice.

`PATCH /api/v1/users/me` accepts `language: "en" | "pl" | null`.
`GET /api/v1/users/me` and other UserPublic responses expose that field. Omitted
language fields in partial profile updates preserve the preference. Existing
rows remain null; there is no backfill based on ledger country or currency.
The database also restricts non-null values to supported language codes.

For future scheduled emails, pass the recipient's explicit supported language
into each render and use English when none is set. A background job cannot infer
a browser language. The current mail output is unchanged by this foundation.

## Resources and components

Resources live in `frontend/src/i18n/locales/<language>/<feature>.json` and are
registered by namespace in `i18n/index.ts`. The current namespace is `common`;
add feature namespaces as screens are migrated. Use semantic keys and complete
sentences with interpolation/pluralization, not assembled English fragments.
`react-i18next` provides reactive labels and typed keys. The provider updates
`document.documentElement.lang` whenever the effective language changes.

Tests under `src/i18n` run in the existing frontend unit CI job and verify key
and interpolation consistency. Plural groups must include the categories of
each language; Polish is not restricted to the English one/other pair.

Use helpers from `i18n/format.ts` for presentation. Date-only ISO values are
formatted at UTC to preserve the calendar day; timestamps use the requested or
browser timezone. Decimal amount strings are passed directly to Intl to avoid
Number precision loss; at least two fraction digits and existing sub-cent
precision are retained. Currency codes remain explicit. Percentage helpers take
percentage points: `25` means `25%`. Pass a language explicitly when formatting
outside reactive components; inside components subscribe with `useTranslation`.
Never localize wire values, ISO dates, API keys, enum values, or amounts stored
in the database. Locale changes must not change the ledger's currency, holiday
calendar, timezone, or payment scheduling.

## EN/PL terminology

| English | Polish |
| --- | --- |
| Ledger | Rejestr |
| Obligation | Zobowiązanie |
| Counterparty | Kontrahent |
| Category | Kategoria |
| Component | Składnik |
| Billing period | Okres rozliczeniowy |
| Draft | Szkic |
| Collecting data | Zbieranie danych |
| Ready / Ready to pay | Gotowe do opłacenia |
| Paid | Opłacone |
| Canceled | Anulowane |
| Error | Błąd |
| Unknown amount/date | Nieznana kwota/data |
| Estimated | Szacowane |
| Confirmed | Potwierdzone |
| Overridden | Nadpisane ręcznie |
| Automatic source | Źródło automatyczne |
| Manual source | Źródło ręczne |
| Mixed source | Źródło mieszane |

Keep customer-defined names, notes, schema labels, and external data in their
original form. Translate known system fields by meaning, not arbitrary strings.

## Verification

- `bun run --filter frontend test:unit` covers resolution, formatting, resource
  contracts, and mounted React selectors (including shared demo and failures).
- `bun run --filter frontend build` checks the production bundle and TypeScript.
- Playwright defaults explicitly to `en-GB` so existing accessible-name selectors
  do not depend on the test runner's browser language.
- Backend language API tests exercise real authentication, persistence, partial
  updates, invalid inputs, and demo restrictions with an isolated user store.
