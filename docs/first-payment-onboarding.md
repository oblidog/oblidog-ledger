# First recurring payment (#382, #636)

With no ledger, the dashboard shows one empty state that opens the regular
ledger form. With the guide enabled, that state explains the first step. For an
existing ledger, owners and editors see the next action. Turning off the guide
saves the preference on the account and hides it for all ledgers. The profile
settings can turn it back on.

The API checks for an active recurring category with a payment in one of its
scheduled billing periods. The lookup returns setup status without loading
the payment history into the browser. Configured ledgers skip the guide. When a
user follows the guide and then returns to the dashboard after creating a
recurring payment, they see a one-time confirmation with an optional link to
integrations. If several schedules are waiting for their first payment, a hybrid
category takes precedence so manual setup can continue immediately.

The demo guide links to the regular Categories view in the sample ledger and
explains how to open a saved payment. The guide keeps the category and payment
screens in read-only preview mode. If a category has no saved payment, visitors
can return to Categories and choose another example. The regular navigation
continues to use the configured demo permissions.

## Compatibility and cleanup

The self-hosted v0.22.1 frontend predates the wizard. The previous `dev` frontend
contains the wizard and is a source for Vercel demo previews. Existing preview
builds and already-open browser sessions can still call the old API. The
wizard API and saved state stay available during this transition.

Published ledgers, groups, categories and obligations remain available in the
regular screens. The old wizard saved category and schedule drafts separately
until its final commit. The new guide uses published records. A user who paused
with an unpublished draft can continue from any ledger already created and
enter the remaining details in the regular forms.

After all wizard-based frontends have been replaced and the rollback window has
ended, verify the old endpoints have no consumers before removing their routes,
generated client contract and saved draft state. Treat the state removal as a
separate migration.

## Pilot checklist — pending human validation

Run with 3–5 people unfamiliar with Oblidog, using fictional payment details.
Provide only this task: “Add a monthly internet bill, leave and return to the
setup once, and make the first payment ready without connecting an integration.”
Do not explain ledger/category/status terminology until the participant gets
stuck. Record any assistance as a blocker instead of counting an assisted
completion as success.

For each participant check:

- They find the optional start action and understand a ledger and a category.
- They create or select the workspace and group without API knowledge.
- They understand the recurrence and business-calendar due date.
- They interrupt, reload and resume without creating duplicates.
- They understand that unknown/estimated data still needs confirmation.
- They distinguish ready from paid and find the resulting obligation.
- They understand that integrations can be skipped.
- They can dismiss the guide and continue with ordinary forms.

Record only anonymous participant labels, approximate completion time, where
help was needed, confusing UI text, viewport/language, and a follow-up decision.
Do not collect account identifiers, credentials, screenshots containing personal
bills, amounts from real accounts or other financial data.

| Participant | Independent completion | Blocker / confusing wording | Follow-up decision |
| --- | --- | --- | --- |
| P01–P05 | Not run | No human findings yet | Schedule pilot after review |

Automated tests are not a substitute for this pilot. Keep the pilot acceptance
criterion open until actual observations and follow-up decisions are recorded.
Realistic demo dataset changes remain outside this issue (#317).
