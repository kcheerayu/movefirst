# Vercel deployment guide

This platform is a dynamic Next.js application. Deploy it as a Vercel Next.js project; do not use static export.

## Before creating the Vercel project

1. Push the repository, including migrations through `20260728000000`.
2. Confirm the linked Supabase project has the same migrations with `supabase migration list --linked`.
3. Keep `.env.local` local. It must never be committed or uploaded as a file.

## Create the Vercel project

1. In Vercel, choose **Add New → Project**.
2. Import this repository and select the repository root as the project root.
3. Let Vercel detect **Next.js**.
4. In **Settings → Build and Deployment**, set **Node.js Version** to **22.x**. The repository also enforces `22.x` in `package.json` and `.nvmrc`.
5. Leave the default commands:
   - Install: Vercel detects `package-lock.json` and runs `npm install`.
   - Build: `npm run build`.
   - Output: leave blank; Vercel detects Next.js output automatically.

## Environment variables

Add these in Vercel for the **Production** environment. Use the same public Supabase URL and anon key as local development, and keep the service-role key server-only.

| Variable | Required | Production value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service-role/secret key; never expose it in browser code |
| `NEXT_PUBLIC_SITE_URL` | Yes | Final canonical HTTPS origin, for example `https://app.example.com` |

Do **not** set `NEXT_PUBLIC_DEVELOPMENT_PREVIEW` in Vercel. The code ignores it in production, but omitting it avoids confusion.

For the first deployment, the final Vercel URL is not known yet. Use the generated production URL from the first deployment as a temporary `NEXT_PUBLIC_SITE_URL`, then replace it with the canonical custom domain after that domain is attached. Redeploy after each change.

## Configure Supabase Auth URLs

In Supabase Dashboard, open **Authentication → URL Configuration**.

Set **Site URL** to the final production canonical origin. Until a custom domain is attached, this may be the Vercel production URL.

Add these Redirect URLs exactly:

| Environment | Redirect URL |
| --- | --- |
| Local | `http://localhost:3000/auth/callback` |
| Local recovery | `http://localhost:3000/auth/callback?next=/auth/reset-password` |
| Production | `https://<your-production-domain>/auth/callback` |
| Production recovery | `https://<your-production-domain>/auth/callback?next=/auth/reset-password` |

Replace `<your-production-domain>` only after Vercel gives you its production URL or after you attach the final custom domain. Do not add a broad production wildcard. If you later decide to test email authentication on Vercel preview deployments, add the narrowly scoped Vercel preview wildcard recommended by Supabase for your team slug; it is not required for normal production deployment.

The invitation and recovery APIs pass `redirectTo`, so check the Supabase **Invite user** and **Reset password** email templates. Their link must use `{{ .RedirectTo }}` rather than a hard-coded URL or `{{ .SiteURL }}`. Keep the default templates otherwise unless you are ready to customize branding.

## Deploy and verify

1. Deploy from Vercel after setting the initial environment variables.
2. Copy the generated production URL.
3. Set `NEXT_PUBLIC_SITE_URL` in Vercel to that exact origin.
4. Set Supabase Site URL and the two production Redirect URLs above.
5. Redeploy so the build uses the canonical site URL.
6. Sign in as the existing OWNER.
7. Invite a real secondary email address and accept its invitation.
8. Verify that its role, agent grants, client grants, and client URL authorization behave as expected.
9. Verify sign-out, password recovery, invalid/expired email links, deactivation, and reactivation.

There is intentionally no public signup route.

## Final production checks

Run locally on Node 22 before each release:

```bash
npm test
npm run test:integration
npm run lint
npm run build
supabase migration list --linked
```

`npm run test:integration` creates and removes a disposable Supabase Auth user and two disposable clients. It never changes the existing OWNER.
