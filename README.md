# Move First Platform

Private operating system for Move First agents, client workspaces, and internal operations. This repository deliberately does **not** modify or embed `move-first-outbound`.

## Architecture

- Next.js App Router + TypeScript + Tailwind CSS
- Supabase Auth and PostgreSQL with RLS
- Named permissions, role assignments, and explicit user/client/agent access grants
- Agent registry for UI metadata; database telemetry tables for real workers

## Local development

1. Use Node 22+ and `npm install`.
2. Copy `.env.example` to `.env.local`.
3. For an interface-only local preview, set `NEXT_PUBLIC_DEVELOPMENT_PREVIEW=true`. It only works outside production and is visibly labeled.
4. Run `npm run dev`.

Preview mode is isolated in `src/lib/data/preview.ts`. Production never falls back to it, and no real authentication or authorization path accepts preview data.

## Supabase setup

1. Create a Supabase project and add the URL and anon key to `.env.local`.
2. Install the Supabase CLI and run `supabase link --project-ref <ref>` followed by `supabase db push` to apply `supabase/migrations`.
3. Configure Auth redirect URLs for local development and your Vercel domain.
4. Create the first Auth user through the Supabase dashboard, then run `OWNER_EMAIL=owner@company.com npm run bootstrap:owner` once.
5. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. It is for admin lifecycle actions and must never be prefixed `NEXT_PUBLIC_`.

Database writes are intentionally not exposed to browser policies. Every application table has RLS enabled. Browser reads are limited to active users' scoped profiles, clients, agent telemetry, and activity; all writes and administrative reads use server-only service-role code after server authorization. User grants, client changes, and audit insertion use transactional database RPCs.

## Authorization model

Every request resolves identity with `supabase.auth.getUser()` and obtains the active profile/access scope through `app_current_context()`. UI navigation is filtered for usability, but access decisions are made server-side via `requirePermission`; client and agent data must also be queried with RLS-scoped access. Client authorization uses UUIDs, while slugs are routing-only. Never trust a user ID, role, client ID, or permission sent from a browser.

Deactivating a user revokes database-backed Supabase sessions and applies an Auth ban. Reactivation removes the ban but never restores revoked sessions; the person must authenticate again.

## Agent integration

Each future agent gets a registry entry, protected route, permissions/access grants, client capability records, and worker reporting into `agent_runs`, `agent_steps`, and `agent_events`. `move-first-outbound` will later be connected behind `/agents/outreach` through an adapter/API boundary; it is not changed by this foundation.

## Deployment

For the complete Vercel, Supabase Auth URL, email-template, and verification checklist, follow [DEPLOYMENT.md](./DEPLOYMENT.md). Set Node.js 22.x and the three Supabase environment variables plus `NEXT_PUBLIC_SITE_URL`; do not set `NEXT_PUBLIC_DEVELOPMENT_PREVIEW` on Vercel. Run checks before deploying:

```bash
npm run lint
npm test
npm run test:integration
npm run build
```
