# First recurring payment (#382)

The guide is optional. Empty dashboards/workspaces offer it, and an interrupted
setup can be resumed from the dashboard, workspace or ledger list. It never
opens automatically. Existing users with populated ledgers get no new setup
prompt. A dismissed prompt becomes a small resume button; normal forms remain
available. The initial guide supports ledgers owned by the current user.

## Persistence and publication

`GET /api/v1/onboarding/` reads the user's saved state. Commands to the same
endpoint carry the last revision. A user-row lock serializes concurrent tabs;
a stale revision returns `onboarding_changed`, prompting a progress refresh.
The lock, state change and domain writes commit in a single transaction.

1. Choose an owned ledger or create one. Re-entering its name after restarting
   reuses the existing active ledger; its existing preferences take precedence.
2. Describe the category and select an existing group or enter a new group name.
3. Set and preview the schedule. Steps 2–3 store drafts, without publishing a
   category that the scheduler could pick up.
4. Create the group (if needed), category and first obligation together. An
   unused four-letter code is generated unless the user supplies one.

Back changes the current step and preserves the saved drafts. Finish later saves
completed steps; unsent edits in the current step are not saved. Start over
clears the guide's draft, without deleting a workspace already created. If the
workspace or group was deleted/archived while paused, the user can go back or
start over and select a valid one. A conflicting name/code rolls back the whole
final transaction, including a newly created group.

The category uses `hybrid`, because `manual` disables recurrence. Integration
setup is optional and does not affect completion. An unknown amount produces a
collecting-data obligation; a known amount remains estimated unless the user
confirms both amount and effective due date. Confirming marks it ready, never
paid. Future obligations use the normal scheduler and estimation rules.

The first obligation uses the anchor's billing period even when the business
calendar moves the due date into the previous month. Its creation and ready
confirmation use the existing use cases and action log with the current user
as actor. The normal generator subsequently reuses its business key.

`POST /api/v1/onboarding/schedule-preview` is an authenticated, read-only
calculation using the common business-calendar rules. It also previews a
workspace that has not been saved, without creating it.

## Demo

Demo exposes a small “Try the setup guide” button even with populated data.
The same forms run as a local, ephemeral preview. Commands never reach the
shared account, regardless of `DEMO_WRITES_ENABLED`; the API rejects onboarding
mutations in demo as well. Only the side-effect-free schedule preview is
allowed in read-only demo. Currency and calendar selections are reflected in
the preview. Closing the guide discards its local progress. The completion
screen explicitly says no data was saved and has no links to fictional entities.

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
