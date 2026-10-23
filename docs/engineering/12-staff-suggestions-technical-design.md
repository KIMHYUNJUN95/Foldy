# Staff Suggestions Technical Design

Status: **First slice complete & internally shippable 2026-06-16 (Steps 1–8)** — schema + create + list
+ detail + comments + status + notifications + i18n/QA hardening. Migrations (all **pending apply** to the linked Supabase project):
`202606160001_staff_suggestions.sql` + `202606160003_suggestion_notifications.sql` +
`202606160004_suggestion_image_storage.sql` (debug-pass storage-RLS fix) +
`202606160005_update_staff_suggestion_fn.sql` (atomic author-edit function). See the per-step "As-built"
sections below. **Debug pass 2 (2026-06-16):** author edit/delete (submitted-only) is now implemented
and the list card shows the correct counterparty per segment (see "As-built — Debug pass 2"). **Debug
pass 3 (2026-06-16):** the author edit is now **atomic** (single-transaction Postgres function — fixes a
reference-loss data-integrity bug) and changing the recipient notifies the new recipient (see "As-built —
Debug pass 3"). **2026-06-24 follow-up:** the shared context picker now allows **building-only**
links for suggestions, and suggestion notifications surface in the live `/mobile/notifications` bell
feed.

## As-built — Step 1 (schema only, 2026-06-16)

Implemented exactly per the Data Model + Constraint Direction below, with these concrete choices:

- Tables `staff_suggestions`, `staff_suggestion_references`, `staff_suggestion_comments` created with
  `gen_random_uuid()` PKs and a `set_updated_at()` trigger on the two mutable tables.
- FK delete behavior: `organization_id`, `suggestion_id`, reference `user_id` → `cascade`;
  `created_by_user_id` / `recipient_user_id` / comment `created_by_user_id` → `restrict`;
  `property_id` / `room_id` → `set null`.
- All recommended CHECK constraints applied, plus a comment "not fully empty" check
  (`trim(body) <> '' or array_length(image_urls,1) > 0`). The "referenced user ≠ author/recipient"
  rule is **server-side only** (not a DB constraint, since it needs the parent row).
- All recommended indexes created (Sent / Received / status / context / referenced / comment thread).
- Visibility helper implemented as a `SECURITY DEFINER` SQL function
  `public.can_view_staff_suggestion(uuid)`; the three SELECT policies use it (+ `is_platform_admin()`).
- RLS: **read-only** participant policies; **no write policies** — all writes go through service-role
  server actions in later steps (none added yet).
- TS types added to `src/types/database.ts`; small shared module `src/lib/suggestions.ts` exports the
  row type aliases, the `StaffSuggestionStatus` union, `STAFF_SUGGESTION_STATUSES`, and
  `STAFF_SUGGESTION_MAX_IMAGES` (no queries / actions / UI yet).
- Notification enum values are intentionally **not** added in this step (notifications are a later step).

## As-built — Step 2 (create flow, 2026-06-16)

Wired the suggestion creation flow onto the finalized compose UI (no redesign).

- Server action `createStaffSuggestion(formData)` in `src/app/mobile/suggestions/actions.ts`:
  validates session + org membership; requires title/body; requires a recipient that is an **active
  same-org member and not the author** (validated against `getShareableUsers`, which excludes self);
  filters referenced users to active same-org members, **deduped and never the author or recipient**;
  caps photos at 5; inserts `staff_suggestions` (status `submitted`) + `staff_suggestion_references`
  via the **service-role client** (read-only RLS); rolls back the parent if the reference insert
  fails; redirects to `/mobile/suggestions` on success (or back to `…/new?error=` on failure).
- Compose (`suggestions-compose.tsx`) is now controlled. The member picker
  (`suggestions-user-picker.tsx`) was made data-driven with a `mode` prop — **single-select for the
  recipient, multi-select for references** — fed by `getShareableUsers`.
- Building·room reuses the shared **`ContextPickerSheet`** (only `propertyId / propertyName / roomId /
  roomLabel` from the returned `LinkedContext` are persisted; reservation/guest are ignored). `roomId`
  / `roomLabel` may be `null`, so a **building-only** suggestion context is valid.
- Photos reuse the shared **`uploadRequestImages`** (new `suggestion-images` path in the
  `request-images` bucket) + the now-exported **`compressImageFile`** — no new upload architecture.
- i18n: only the new feedback strings were added (`mobile.suggestionErrors.*`, ko/ja/en); the slice's
  existing Korean labels are unchanged.
- Not in this step: list/detail/comment/status/notification wiring (later steps).

## As-built — Step 3 (list queries, 2026-06-16)

Wired the main list to real data (read-only; no detail/comment/status/notification yet).

- New server-only module `src/lib/suggestions-queries.ts` → `getSuggestionListData(session)` returns
  `{ sent, received, referenced }` of `SuggestionListItem` (id, status, title, excerpt, recipientName,
  referencesCount, commentCount, createdAt). Kept separate from `src/lib/suggestions.ts` because that
  module is client-imported (server client would drag `next/headers` into the client bundle).
- Segments: **Sent** = `created_by_user_id = me`, **Received** = `recipient_user_id = me`,
  **Referenced** = through `staff_suggestion_references` (`user_id = me`, embedding the parent
  suggestion). All scoped to the org; participant RLS is the backstop. Reads use the RLS-scoped server
  client (no service role needed for reads).
- Counts: reference + comment counts are resolved for the union of visible suggestion ids (one query
  each, counted in JS); recipient display names via a single `memberships`→`profiles` lookup. Schema
  errors degrade to empty segments.
- Filter (client-side over the loaded data): `active` = `submitted` + `reviewing` (the documented
  active-work default), `all`, or a single status. Segment counts reflect the current filter. Relative
  time is `Intl.RelativeTimeFormat` (locale-correct, gated on a hydration flag to avoid SSR mismatch).
- Empty state per segment+filter uses `mobile.suggestionsEmpty` (ko/ja/en). The list card visual is
  unchanged.

## As-built — Step 4 (detail queries, 2026-06-16)

Wired the detail thread to real data, role-aware. No comment CRUD / status mutation / notifications.

- `getSuggestionDetail(session, id)` (`src/lib/suggestions-queries.ts`) → `SuggestionDetail | null`.
  **Participant-only**: RLS hides non-participant rows (`maybeSingle()` → null), and the helper also
  derives `viewerRole` (`author` / `recipient` / `referenced`) and returns null if the user is none of
  them. Loads author/recipient/referenced people (names via a shared `fetchMemberNames`
  memberships→profiles lookup), title/body/category/status/hold_reason/completion_note/property·room/
  image_urls/timestamps, and the **read-only** comment list (author name + role + image count).
- The route guard mirrors the tasks pattern: `null` → `redirect("/mobile/suggestions")` (no existence
  leak).
- UI: a **single role-aware** `SuggestionsDetail` renders all three treatments (recipient = status
  bar; referenced = comment composer; author = neither), preserving the finalized design. Hold-reason
  shows when `on_hold`, completion-note when `completed`. At this step the status sheets and comment
  composer were still non-functional shells; they were wired in Steps 6 and 5 respectively (see those
  sections — the live behavior supersedes this description). The old separate `suggestions-detail-referenced`
  component + `/mobile/suggestions/referenced` route are superseded (route now redirects to the list).
- No new i18n strings were required (the slice's labels stay Korean; relative time via Intl).

## As-built — Step 5 (comments, 2026-06-16)

Comment create / update / delete are live; status-change mutation + notifications still pending.

- Actions in `src/app/mobile/suggestions/actions.ts` (service-role writes; return result objects, no
  redirect): `createStaffSuggestionComment` (any visible participant — author/recipient/referenced,
  verified server-side via `loadParticipantIds`), `updateStaffSuggestionComment` /
  `deleteStaffSuggestionComment` (**comment-author-only**). All enforce org membership, "not fully
  empty" (text OR ≥1 photo), and the 5-photo cap. **Comment permissions are independent of suggestion
  status** — allowed at `submitted` / `reviewing` / `on_hold` / `completed`. Each revalidates the
  detail path.
- UI: `suggestion-comment-composer.tsx` (text + photo attach, reusing `compressImageFile` +
  `uploadRequestImages` → `suggestion-images/` path) is shown to **all participants**; for the
  recipient it is stacked below the status bar (raised inline). `suggestion-comment-item.tsx` renders
  each comment and exposes inline **edit (text; existing photos preserved) / delete (two-step
  confirm)** only on the viewer's own comments. The thread is no longer read-only.
- The list's comment counts (already computed in Step 3) become accurate as comments are
  created/deleted (revalidation on the list path happens on next load / refresh).
- No new i18n: composer/edit feedback reuses `mobile.suggestionErrors.*`; labels stay Korean.

## As-built — Step 6 (status workflow, 2026-06-16)

The recipient status workflow is live; notifications still pending.

- `updateStaffSuggestionStatus` (`src/app/mobile/suggestions/actions.ts`, service-role, returns a
  result object): session+org guard, **recipient-only** (author/referenced rejected `forbidden`),
  validates the target is one of the four statuses, requires `holdReason` for `on_hold` and
  `completionNote` for `completed` (also enforced by the DB CHECKs), persists `status` + the relevant
  note, and revalidates the list + detail. **Transitions are freely reversible** (no graph); status
  never changes automatically.
- UI: the existing recipient status bar + sheets now submit. The status sheet's direct options
  (submitted / reviewing) call the action immediately; the **hold-reason** and **completion-note**
  sheets use controlled textareas (pre-filled from the current note), disable submit until filled,
  and call the action with the note. On success the sheets close and the detail refreshes; the status
  bar + `on_hold` / `completed` banners reflect the new value. The radio highlight is driven by the
  real `data.status`. Errors surface inline via `mobile.suggestionErrors.save_failed`.
- List status chips + filters already read real status (Step 3), so they update after a change.
- Permission is enforced server-side (recipient-only), not just by hiding the UI for other roles.

## As-built — Step 7 (notifications, 2026-06-16)

In-app notifications for all four events; the first slice is now functionally complete.

- One discriminated type **`suggestion_activity`** (migration `202606160003_suggestion_notifications.sql`;
  `database.ts` enum + `NotificationPayloadByType` updated) carries every event via `payload.event`
  (`created` / `referenced` / `status` / `comment`), mirroring `task_updated`. Payload
  `SuggestionNotificationPayload = { suggestionId, suggestionTitle, actorUserId, event, status? }`.
- Fan-out helper `notifySuggestionParticipants` (`src/lib/notifications/create.ts`) — skips the actor,
  dedupes per recipient, deep-links to `/mobile/suggestions/{id}`, `sourceType: "staff_suggestion"`.
  **Targets are always restricted to valid participants by the caller**, so notifications never leak
  existence to non-participants.
- Wiring (`src/app/mobile/suggestions/actions.ts`): **create** → recipient (`created`) + referenced
  (`referenced`); **status** → author + referenced (`status`, with the new `status`); **comment** →
  the other participants (`comment`). The author **edit** flow (Debug pass 2/3) also fires `referenced`
  for newly-added references and `created` for a changed recipient. Self-notifications are suppressed by
  the helper.
- Display: `getNotificationDisplay` branches on `payload.event` (status events specialise `on_hold` /
  `completed` copy); `mobile.notifications.suggestion*` (ko/ja/en); `notificationTypeLabel` →
  `suggestionKind`. No notification-UI redesign.
- No per-user notification toggle exists in the codebase yet, so "notify only if enabled" maps to the
  existing always-on behavior (matching tasks/orders); self-suppression + participant scoping apply.

## As-built — Step 8 (i18n, QA, cleanup, 2026-06-16)

Final hardening pass — the feature is internally shippable.

- **Full i18n.** All suggestions UI strings moved into a single `dict.mobile.suggestions` group
  (ko/ja/en) — list tabs/filters, form labels/placeholders, buttons, validation/error messages, empty
  states, status labels, hold/completion prompts, picker labels, comment UI, page titles. The group
  nests `errors` (former `suggestionErrors`) and `empty` (former `suggestionsEmpty`); the two old flat
  keys were removed. Every component takes a `copy: Dictionary["mobile"]["suggestions"]` prop; the 3
  pages pass `dict.mobile.suggestions`. No remaining hardcoded UI copy in the active components;
  relative time stays on `Intl.RelativeTimeFormat`.
- **Empty / error states.** List shows `copy.empty` per segment+filter; detail redirects on
  missing/forbidden (no leak) and falls back to `—` for missing names; comment + status flows surface
  inline errors (`copy.errors.save_failed` etc.). Server reads/writes degrade gracefully if the schema
  isn't applied yet.
- **Validation/permission (verified).** recipient required + `≠ author`; references deduped and never
  author/recipient; suggestion + comment photos capped at 5; empty comments blocked (text or ≥1 photo);
  recipient-only status; `on_hold`/`completed` notes required; comment edit/delete is comment-author
  only. All enforced server-side (service-role actions) and most mirrored by DB CHECKs.
- **Cleanup.** Deleted the dead `suggestions-detail-referenced.tsx` (superseded in Step 4); refreshed
  stale "shell" docstrings in `suggestions-detail.tsx`.
- **Debug-pass fix (storage RLS).** Photo uploads use the shared `request-images` bucket at
  `${org}/suggestion-images/${id}/${file}`, but the bucket's upload/delete policies whitelisted only
  the older folders — so suggestion photo uploads (compose + comments) were rejected by storage RLS.
  Migration `202606160004_suggestion_image_storage.sql` re-creates both policies with
  `suggestion-images` added, and (because suggestions are open to all active members) lets
  `part_time_staff` upload/delete **only** under the `suggestion-images` folder (other folders keep the
  existing exclusion). Reads are unaffected (bucket is public). Note: suggestion/comment image deletes
  currently leave storage orphans (the row is removed but the object is not), matching the create-time
  orphan behavior — acceptable for the first slice.
- **Known limitations.** Suggestion/comment image deletes still leave storage orphans (the row is
  removed but the object is not), matching the create-time orphan behavior — acceptable for the first
  slice. The notification center itself is live.

## As-built — Debug pass 2 (author edit/delete + list card, 2026-06-16)

Closes two issues from a feature debug review.

- **Author edit/delete (the missing core rule).** `updateStaffSuggestion` / `deleteStaffSuggestion`
  (`src/app/mobile/suggestions/actions.ts`, service-role): **author-only and only while
  `status = 'submitted'`** (re-checked server-side; otherwise bounce to the detail). Update covers
  title / body / category / recipient / references / property·room / photos, re-syncs the reference
  set, and notifies **newly added** referenced users (`referenced` event). *(Debug pass 3 made the
  re-sync atomic and added new-recipient notification — see below.)* Delete is a hard delete
  (references + comments cascade). Edit UI reuses the compose form via a new
  `/mobile/suggestions/[id]/edit` route (`SuggestionsCompose` gained `editId` + `initial` props and an
  `existingImages` strip so already-uploaded photos are kept; total still capped at 5). The detail
  screen shows **edit / delete** affordances to the author only while submitted (delete is a two-step
  inline confirm). `getSuggestionDetail` now also returns `propertyId` / `roomId` so the edit form can
  preserve the context FK.
- **List card counterparty.** `getSuggestionListData` now returns `authorName`; the card shows the
  **author** on Received / Referenced (label "보낸 사람") and the **recipient** on Sent (label
  "받는 사람"), instead of always showing the recipient (which on Received was the viewer themselves).

## As-built — Debug pass 3 (atomic author edit + recipient-change notification, 2026-06-16)

Closes a data-integrity bug and a missing notification in the author edit flow.

- **Atomic reference re-sync (data-integrity fix).** Debug pass 2 implemented the author edit as
  separate statements: UPDATE the suggestion, then DELETE all reference rows, then re-INSERT the new
  set. If the re-insert failed after the delete succeeded, the suggestion could **lose all referenced
  users while still reporting success** (silent partial state). The write is now done in a single
  Postgres function `public.update_staff_suggestion(...)` (migration
  `202606160005_update_staff_suggestion_fn.sql`) — a plpgsql function body is one transaction, so a
  failed insert rolls back the delete **and** the field update together. On any RPC error the action
  redirects back to the edit screen with `?error=save_failed` (no silent success path). The function is
  `SECURITY DEFINER`, `grant execute … to service_role` only; **authorization (author-only,
  `status='submitted'`, recipient/reference validation) stays in the server action and runs before the
  RPC** — the function only performs the write.
- **Returns previous references.** The function captures the pre-update reference `user_id`s into an
  array and `returns uuid[]`, so the action computes `added = newRefs − oldRefs` for the `referenced`
  notification precisely (no double-notifying users who were already referenced) without a separate
  read.
- **Recipient-change notification.** The action snapshots `recipient_user_id` before the update. After a
  successful edit, if `recipientId !== previousRecipientId` it notifies the **new** recipient via
  `notifySuggestionParticipants` reusing the `created` event (deep-links to the suggestion). If the
  recipient is unchanged, nothing is sent; the helper still suppresses self-notification. Visibility is
  not broadened — only the (already-valid, server-checked) new recipient is targeted.
- **RPC typing.** `database.ts` omits the RPC signature, so the call is typed via a local
  `SuggestionEditRpcClient` cast (`(supabase as unknown as SuggestionEditRpcClient).rpc(...)`), mirroring
  the `onboarding/actions.ts` pattern.

## Purpose

This document defines the first-slice technical design for the Staff Suggestions / Feedback Box.

The first slice is a participant-scoped feedback thread, not a public board and not an admin-only review queue.

The feature must support:

- one required recipient
- optional referenced users
- recipient-only status ownership
- participant comments
- photos on the main suggestion and on comments
- participant-scoped notifications

## First-Slice Goal

Deliver:

- create suggestion flow
- sent / received / referenced list queries
- detail thread
- comment create/edit/delete
- recipient-only status update
- notification hooks for create / reference / status / comment

## Data Model

### `staff_suggestions`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
created_by_user_id uuid not null references profiles(id)
recipient_user_id uuid not null references profiles(id)
title text not null
body text not null
category text
status text not null default 'submitted'   -- submitted | reviewing | on_hold | completed
hold_reason text
completion_note text
property_id uuid references properties(id)
property_name text
room_id uuid references rooms(id)
room_label text
image_urls text[] not null default '{}'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Notes:

- `category` is optional free text.
- `recipient_user_id` is one required active member in the same organization.
- `recipient_user_id` should not equal `created_by_user_id`.
- `property_id` / `room_id` are optional context links.
- `property_name` / `room_label` are display fallbacks.
- `image_urls` is capped at 5 by server validation.
- `hold_reason` is required when status becomes `on_hold`.
- `completion_note` is required when status becomes `completed`.

### `staff_suggestion_references`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
suggestion_id uuid not null references staff_suggestions(id) on delete cascade
user_id uuid not null references profiles(id)
created_at timestamptz not null default now()
```

Notes:

- one row per referenced user
- unique `(suggestion_id, user_id)`
- referenced users must be active members in the same organization
- referenced users should not duplicate the author or recipient

### `staff_suggestion_comments`

```txt
id uuid primary key
organization_id uuid not null references organizations(id)
suggestion_id uuid not null references staff_suggestions(id) on delete cascade
created_by_user_id uuid not null references profiles(id)
body text
image_urls text[] not null default '{}'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Notes:

- comment author must be one of the visible participants
- comment may be text-only, image-only, or both, but not fully empty
- `image_urls` is capped at 5 by server validation
- comment edit/delete is allowed only for the comment author

## Constraint Direction

Recommended database-level constraints:

- `status in ('submitted', 'reviewing', 'on_hold', 'completed')`
- `char_length(trim(title)) > 0`
- `char_length(trim(body)) > 0`
- `coalesce(array_length(image_urls, 1), 0) <= 5` on suggestion rows
- `coalesce(array_length(image_urls, 1), 0) <= 5` on comment rows
- `status != 'on_hold' or char_length(trim(coalesce(hold_reason, ''))) > 0`
- `status != 'completed' or char_length(trim(coalesce(completion_note, ''))) > 0`

Recommended indexes:

- `staff_suggestions (organization_id, created_by_user_id, created_at desc)` for Sent
- `staff_suggestions (organization_id, recipient_user_id, created_at desc)` for Received
- `staff_suggestion_references (organization_id, user_id, created_at desc)` for Referenced
- `staff_suggestions (organization_id, status, created_at desc)` for status filtering
- `staff_suggestions (organization_id, property_id, created_at desc)` for context filtering
- `staff_suggestion_comments (suggestion_id, created_at asc)` for thread rendering

## Visibility Logic

A suggestion is readable only to:

- author
- recipient
- referenced users
- platform-admin bypass

No organization-wide visibility exists in this feature.

Visible participants can see:

- author identity
- recipient identity
- referenced users list
- main content
- comments

## Mutation Rules

### Create Suggestion

- any active organization member can create
- one recipient is required
- recipient must belong to the same organization and must not be the author
- referenced users are optional
- referenced users must belong to the same organization
- initial status = `submitted`

### Author Update / Delete

The author can update or delete the main suggestion only while:

- `status = 'submitted'`

Editable fields during `submitted`:

- recipient
- referenced users
- title
- body
- category
- property / room context
- main `image_urls`

After status leaves `submitted`, the main suggestion body becomes author read-only.

### Recipient Status Update

Only the recipient can update:

- `status`
- `hold_reason`
- `completion_note`

Status rules:

- `submitted -> reviewing | on_hold | completed`
- `reviewing -> submitted | on_hold | completed`
- `on_hold -> submitted | reviewing | completed`
- `completed -> submitted | reviewing | on_hold`

Allowed simplification:

- any recipient-driven transition among the 4 statuses is valid if note requirements are satisfied

### Comments

Allowed actors:

- author
- recipient
- referenced users

Comment permissions:

- insert: any visible participant
- update/delete: comment author only
- comment edit/delete is not blocked by suggestion status

## RLS Direction

Recommended baseline:

- suggestion insert: any active org member
- suggestion select: only author / recipient / referenced users / platform admin
- suggestion update:
  - author only for main-body edits while `submitted`
  - recipient only for status fields (platform developer may too — 2026-10-23; developers also see every org suggestion
    in the 「받은」 list and may comment. See 05 「개발자 예외」)
- suggestion delete:
  - author only while `submitted`
- reference-row management:
  - author only while parent suggestion is `submitted`
- comment select:
  - same participant set as the parent suggestion
- comment insert:
  - visible participants only
- comment update/delete:
  - comment author only

Recommended implementation shape:

- keep strong business validation in server actions
- mirror visibility and mutation boundaries in RLS so UI-only checks cannot leak data

## Recommended Helper Logic

Useful helper concepts:

- `canViewSuggestion(user_id, suggestion_id)`
- `isSuggestionRecipient(user_id, suggestion_id)`
- `isSuggestionReference(user_id, suggestion_id)`
- `canEditSuggestionBody(user_id, suggestion_id)` = author and `status = 'submitted'`
- `canEditSuggestionComment(user_id, comment_id)` = comment author

These can be implemented as SQL helpers, server utility functions, or both.

## Server Actions / Routes

Recommended actions:

- `createStaffSuggestion`
- `updateStaffSuggestion`
- `deleteStaffSuggestion`
- `updateStaffSuggestionStatus`
- `createStaffSuggestionComment`
- `updateStaffSuggestionComment`
- `deleteStaffSuggestionComment`

Recommended route surfaces:

- `/mobile/suggestions?view=sent`
- `/mobile/suggestions?view=received`
- `/mobile/suggestions?view=referenced`
- `/mobile/suggestions/new`
- `/mobile/suggestions/[id]`

Admin web, if added early, should mirror the same views instead of introducing a different admin-only queue model.

## Query Direction

Required list queries:

- Sent: suggestions where `created_by_user_id = currentUser`
- Received: suggestions where `recipient_user_id = currentUser`
- Referenced: suggestions joined through `staff_suggestion_references.user_id = currentUser`

Recommended filters:

- status
- recipient
- author
- property
- room

Recommended default list behavior:

- default to active work emphasis
- show `submitted` + `reviewing` first
- allow filter override to `all`, `on_hold`, `completed`

## UI / Interaction Notes

- The create form must make "recipient required" obvious.
- Referenced users are optional visibility-sharing participants, not extra status owners.
- The detail screen should read like a shared thread:
  - header metadata
  - main suggestion body
  - status chip and required hold/completion note when applicable
  - comment thread
- Status controls should appear only for the recipient.
- Main-body edit controls should appear only for the author while `submitted`.

## Notification Direction

First slice should notify only when the target user has notifications enabled.

Recommended events:

- suggestion created:
  - notify recipient
  - notify referenced users
- recipient/status update:
  - notify author
  - notify referenced users
- comment added:
  - notify other visible participants

Recommended baseline:

- suppress self-notifications
- keep notification payloads thread-oriented, with direct link to the suggestion detail

## Deferred Extensions

- anonymous mode
- organization-wide visibility
- reactions / likes / votes
- multiple status owners
- non-photo attachments
- escalation / whistleblower workflow
- analytics by recipient / category / resolution time
