import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canAccessClient, hasPermission } from "@/lib/auth/scope";
import type { AppContext } from "@/lib/types";

const active:AppContext={user:{id:"user",email:"user@example.test",fullName:"User",role:"MEMBER",status:"active"},permissions:["clients.read","agents.read"],agentSlugs:[],agentIds:[],clientIds:["client-a"],preview:false};
const migration=readFileSync("supabase/migrations/20260728000000_production_security_clients.sql","utf8");
describe("authorization scope",()=>{
  it("allows an assigned client only",()=>{expect(canAccessClient(active,"client-a")).toBe(true);expect(canAccessClient(active,"client-b")).toBe(false);});
  it("does not authorize a disabled account even if direct permissions remain in context",()=>{const disabled={...active,user:{...active.user,status:"disabled" as const},permissions:["clients.manage"]};expect(hasPermission(disabled,"clients.manage")).toBe(false);expect(canAccessClient(disabled,"client-a")).toBe(false);});
  it("allows active client managers across clients",()=>{const manager={...active,permissions:["clients.manage"]};expect(canAccessClient(manager,"another-client")).toBe(true);});
});
describe("database security contract",()=>{
  it("enables RLS for every application table",()=>{for(const table of ["roles","permissions","role_permissions","profiles","user_permissions","agents","user_agent_access","clients","client_members","client_agent_access","agent_runs","agent_steps","agent_events","activity_logs"])expect(migration).toContain(`alter table public.${table} enable row level security`);});
  it("requires active status for both role and direct permission checks",()=>{expect(migration).toMatch(/select public\.app_is_active\(\) and \(/);expect(migration).toContain("from public.user_permissions up");});
  it("has no public signup route and keeps admin credentials server-only",()=>{expect(readFileSync("src/lib/supabase/admin.ts","utf8")).toContain('import "server-only"');expect(readFileSync("src/app/login/page.tsx","utf8")).not.toMatch(/sign.?up/i);});
});
