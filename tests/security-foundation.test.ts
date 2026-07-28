import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canAccessClient, hasPermission } from "@/lib/auth/scope";
import { isPreviewEnabled } from "@/lib/data/preview";
import { authCallbackUrl, getSiteUrl } from "@/lib/site-url";
import { isInvalidSupabaseApiKey } from "@/lib/auth/callback-errors";
import type { AppContext } from "@/lib/types";

const active:AppContext={user:{id:"user",email:"user@example.test",fullName:"User",role:"MEMBER",status:"active"},permissions:["clients.read","agents.read"],agentSlugs:[],agentIds:[],clientIds:["client-a"],preview:false};
const migration=readFileSync("supabase/migrations/20260728000000_production_security_clients.sql","utf8");
const invitationMigration=readFileSync("supabase/migrations/20260728000001_secure_invitation_activation.sql","utf8");
afterEach(()=>vi.unstubAllEnvs());
describe("authorization scope",()=>{
  it("allows an assigned client only",()=>{expect(canAccessClient(active,"client-a")).toBe(true);expect(canAccessClient(active,"client-b")).toBe(false);});
  it("does not authorize a disabled account even if direct permissions remain in context",()=>{const disabled={...active,user:{...active.user,status:"disabled" as const},permissions:["clients.manage"]};expect(hasPermission(disabled,"clients.manage")).toBe(false);expect(canAccessClient(disabled,"client-a")).toBe(false);});
  it("allows active client managers across clients",()=>{const manager={...active,permissions:["clients.manage"]};expect(canAccessClient(manager,"another-client")).toBe(true);});
});
describe("database security contract",()=>{
  it("enables RLS for every application table",()=>{for(const table of ["roles","permissions","role_permissions","profiles","user_permissions","agents","user_agent_access","clients","client_members","client_agent_access","agent_runs","agent_steps","agent_events","activity_logs"])expect(migration).toContain(`alter table public.${table} enable row level security`);});
  it("requires active status for both role and direct permission checks",()=>{expect(migration).toMatch(/select public\.app_is_active\(\) and \(/);expect(migration).toContain("from public.user_permissions up");});
  it("has no public signup route and keeps admin credentials server-only",()=>{expect(readFileSync("src/lib/supabase/admin.ts","utf8")).toContain('import "server-only"');expect(readFileSync("src/app/login/page.tsx","utf8")).not.toMatch(/sign.?up/i);});
  it("keeps preview disabled under production and protects the user admin route",()=>{vi.stubEnv("NODE_ENV","production");vi.stubEnv("NEXT_PUBLIC_DEVELOPMENT_PREVIEW","true");expect(isPreviewEnabled()).toBe(false);expect(readFileSync("src/app/(platform)/admin/users/page.tsx","utf8")).toContain("await requireOwner()");});
  it("uses the canonical site URL for invitation and recovery redirects",()=>{expect(readFileSync("src/app/auth/actions.ts","utf8")).toContain("authCallbackUrl(\"/auth/reset-password\")");expect(readFileSync("src/app/(platform)/admin/users/actions.ts","utf8")).toContain("authCallbackUrl()");});
  it("accepts recovery and invitation token hashes in the existing server callback",()=>{const callback=readFileSync("src/app/auth/callback/route.ts","utf8");expect(callback).toContain('type!=="recovery"&&type!=="invite"');expect(callback).toContain("supabase.auth.verifyOtp({token_hash:tokenHash");});
  it("keeps invited profiles inactive until a verified initial-password setup completes",()=>{expect(invitationMigration).toContain("move_first_initial_password_required");expect(invitationMigration).toContain("app_activate_invited_user");expect(readFileSync("src/app/auth/actions.ts","utf8")).toContain("completeInvitationPasswordSetup(user.id)");});
  it("authorizes login recording with the freshly-issued session, not an ambient route cookie",()=>{const callback=readFileSync("src/app/auth/callback/route.ts","utf8");expect(callback).toContain("accessToken:async()=>accessToken");expect(callback).toContain("recordLogin(data.session.access_token)");});
  it("does not misreport an invalid Supabase REST key as an inactive account",()=>{expect(isInvalidSupabaseApiKey({message:"Invalid API key",hint:"Check the key"})).toBe(true);expect(isInvalidSupabaseApiKey({message:"Account is not active"})).toBe(false);});
  it("accepts only a safe canonical site origin",()=>{vi.stubEnv("NEXT_PUBLIC_SITE_URL","https://platform.example.com");expect(getSiteUrl()).toBe("https://platform.example.com");expect(authCallbackUrl("/auth/reset-password")).toBe("https://platform.example.com/auth/callback?next=/auth/reset-password");});
});
