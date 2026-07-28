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
4. Create the first Auth user through the Supabase dashboard, create its `profiles` record with the `OWNER` role, then use owner-only server actions (to be added in Phase 5) for invitations.
5. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only. It is for admin lifecycle actions and must never be prefixed `NEXT_PUBLIC_`.

Database writes are intentionally not exposed to browser policies. Invitation, role change, access grant, session revocation, and audit insertion should be implemented as validated server actions or tightly scoped RPCs that check the caller’s permission and write an audit record in one transaction.

## Authorization model

Every request resolves identity with `supabase.auth.getUser()` and obtains the active profile/access scope through `app_current_context()`. UI navigation is filtered for usability, but access decisions are made server-side via `requirePermission`; client and agent data must also be queried with RLS-scoped access. Never trust a user ID, role, client ID, or permission sent from a browser.

## Agent integration

Each future agent gets a registry entry, protected route, permissions/access grants, client capability records, and worker reporting into `agent_runs`, `agent_steps`, and `agent_events`. `move-first-outbound` will later be connected behind `/agents/outreach` through an adapter/API boundary; it is not changed by this foundation.

## Deployment

Push to Git, import in Vercel, set Node.js 22 and the three Supabase environment variables, then configure the production Auth redirect URL. Do not set `NEXT_PUBLIC_DEVELOPMENT_PREVIEW` on Vercel. Run checks before deploying:

```bash
npm run lint
npm run build
```
