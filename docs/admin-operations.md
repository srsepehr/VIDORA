# Vidora Admin Operations

Vidora Admin is an internal, Persian-first operations application at `#/admin`.
It is part of the existing Vite application and uses the existing Supabase Auth
session. It is not a separate app and it does not contain an authentication
bypass or a production fixture mode.

## Architecture

```text
authenticated administrator browser
  -> Supabase PostgREST RPC (anon key + administrator JWT)
    -> admin_require_permission(permission)
      -> active admin_membership + centralized admin_role_permissions
        -> bounded read, or transaction containing mutation + audit append
```

Admin tables have RLS enabled and all grants to `anon` and `authenticated` are
revoked. The browser cannot query them directly. `SECURITY DEFINER` functions
use a fixed `search_path`, resolve the actor through `auth.uid()`, and check an
explicit permission before accessing data.

The public user UI and worker architecture are unchanged. The admin bundle is
lazy-loaded only when an admin route is opened.

## Routes

- `#/admin`
- `#/admin/users`
- `#/admin/users/:userId`
- `#/admin/subscriptions`
- `#/admin/payments`
- `#/admin/videos`
- `#/admin/analytics/videos`
- `#/admin/analytics/funnels`
- `#/admin/translation-jobs`
- `#/admin/system`
- `#/admin/audit-log`
- `#/admin/team`
- `#/admin/settings`

Navigation visibility is permission-aware, but visibility is not the security
boundary. Every corresponding RPC independently enforces the same permission.

## Permission matrix

| Capability | Super Admin | Operations | Support | Analyst | Content Manager | Finance |
|---|---:|---:|---:|---:|---:|---:|
| Operational overview | yes | yes | yes | yes | yes | yes |
| Read users and PII | yes | yes | yes | no | no | no |
| Suspend users | yes | yes | no | no | no | no |
| Read subscriptions | yes | yes | yes | no | no | yes |
| Add subscription days | yes | yes | up to 7/request | no | no | no |
| Remove subscription days | yes | yes | no | no | no | no |
| Read payments | yes | no | no | no | no | yes |
| Financial export/refund permission | yes | no | no | no | no | yes |
| Read content | yes | yes | no | analytics only | yes | no |
| Publish/unpublish library content | yes | no | no | no | yes | no |
| Read analytics/funnels | yes | yes | no | yes | yes | yes |
| Inspect jobs | yes | yes | yes | no | no | no |
| Retry failed jobs | yes | yes | no | no | no | no |
| System health | yes | yes | no | no | no | no |
| Audit log | yes | no | no | no | no | no |
| Team and role management | yes | no | no | no | no | no |
| Platform settings | yes | no | no | no | no | no |

The authoritative mapping is seeded into `admin_role_permissions`. The
TypeScript constants are for UI visibility and type safety only.

## Migration

Apply:

```bash
supabase db push
```

Migration `202607190001_admin_operations.sql` adds:

- `admin_role_permissions`
- `admin_memberships`
- immutable `admin_audit_logs`
- immutable-style `subscription_adjustments`
- `payment_records` (provider-webhook contract; empty until integration)
- typed `product_events`
- aggregated `video_playback_sessions`
- `admin_incidents`
- `platform_settings`
- administrative metadata on profiles, jobs, and library videos
- bounded admin read RPCs and transactional mutation RPCs

No development user is seeded and no default administrator is created.

## Initial administrator bootstrap

The first super administrator must be selected by a trusted operator after the
migration. Use the Supabase SQL editor or another service-role-only deployment
path. Never expose a bootstrap endpoint to the browser.

```sql
insert into public.admin_memberships (user_id, role, status)
values ('<existing-auth-user-uuid>', 'super_admin', 'active');
```

After the first super administrator exists, role changes for existing accounts
can be made through the audited team-management RPC. Creating or inviting a new
Auth user still requires a server-side Supabase Admin API endpoint.

## Audited mutations

Implemented mutation RPCs:

- `admin_adjust_subscription_days`
- `admin_set_user_status`
- `admin_retry_translation_job`
- `admin_set_library_video_publication`
- `admin_set_team_member`

Each accepts a human-readable reason and a UUID request ID. Subscription changes
and job retries are idempotent. Mutations append actor, role, target, old/new
values, reason, request ID, user agent, timestamp, and success/failure state.

`admin_audit_logs` has a trigger that rejects updates and deletes. The normal
admin interface has no audit mutation RPC.

## Product events and playback

The browser sends events through `record_product_event`; it cannot choose
`user_id`. The function uses `auth.uid()` and permits only the allowlisted event
taxonomy. Event IDs are unique, property payloads are bounded, and known PII or
content fields are removed.

Trusted database triggers emit:

- `user_signed_up`
- `translation_requested`
- `translation_completed`
- `translation_failed`
- `payment_succeeded`
- `payment_failed`

The private video player emits meaningful start/pause/resume/completion events
and progress at 5% watched-time thresholds. A current-time jump greater than
four seconds is treated as a seek and does not increase watched time.

## Metric definitions

- **Active user:** distinct authenticated user with at least one recorded
  product event in the selected period.
- **Paid user:** distinct user with a successful payment record in the period.
- **Video start:** emitted by an actual media `play` event, not a page view.
- **Video completion:** playback session with at least 90% meaningful watched
  time.
- **Watch time:** accumulated consecutive playback time; seeked intervals are
  excluded.
- **Retention bucket:** percentage of valid playback sessions whose meaningful
  watched-time percentage reached a 5% bucket.
- **Translation success/failure rate:** terminal jobs divided by jobs created in
  the selected period.
- **Revenue:** successful payment amount minus recorded discount.
- **Conversion:** successful paying users divided by new users for the period.

All dashboard reads are date-bounded to at most 370 days. Tables are paginated
server-side with a maximum page size of 100.

## Deployment requirements

1. Apply all Supabase migrations in order.
2. Select and insert the first super administrator through a trusted path.
3. Deploy the updated frontend with the existing public variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_APP_URL`
4. Keep `SUPABASE_SERVICE_ROLE_KEY` only in Supabase/worker/Edge secrets.
5. Redeploy the existing worker so job lifecycle changes are reflected after the
   migration.

No new browser secret or Vite environment variable is required.

## Honest limitations

- Payment tables and views are ready, but no provider or webhook exists yet.
  Revenue remains empty until a verified integration writes `payment_records`.
- New administrator invitation and session revocation require a server-side
  Supabase Admin API endpoint. The browser never receives the service-role key.
- Client IP cannot be trusted from a static browser-to-PostgREST call. Capturing
  legally appropriate IP information requires a trusted Edge gateway.
- Provider availability, storage usage, and deployment status are not available
  from the current database/worker contracts; the system page shows only safe
  queue, processing, provider-failure, and incident summaries.
- Content listing and publish/unpublish are implemented. Full thumbnail upload,
  metadata editing, category editing, and processing re-run need additional
  storage and worker contracts before they can be production actions.
- Financial CSV export is permission-modeled but is not exposed until an audited
  server-side export endpoint exists.
