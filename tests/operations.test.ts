import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isDueThisWeek, isOverdue, projectProgress } from "@/lib/operations-math";
import { clientSlugFromName } from "@/lib/admin/clients";

describe("operational calculations", () => {
  const today = new Date("2026-07-28T12:00:00");
  it("identifies overdue work without counting completed tasks", () => {
    expect(isOverdue({ status: "TODO", due_date: "2026-07-27" }, today)).toBe(true);
    expect(isOverdue({ status: "DONE", due_date: "2026-07-27" }, today)).toBe(false);
    expect(isOverdue({ status: "TODO", due_date: null }, today)).toBe(false);
  });
  it("calculates project progress from persisted task states", () => {
    expect(projectProgress([{ status: "DONE" }, { status: "TODO" }, { status: "DONE" }])).toEqual({ complete: 2, total: 3, percent: 67 });
    expect(projectProgress([])).toEqual({ complete: 0, total: 0, percent: 0 });
  });
  it("treats the next seven days as due soon", () => {
    expect(isDueThisWeek({ status: "TODO", due_date: "2026-08-03" }, today)).toBe(true);
    expect(isDueThisWeek({ status: "TODO", due_date: "2026-08-04" }, today)).toBe(false);
  });
  it("keeps project and task mutations behind the OWNER server guard", () => {
    const operations = readFileSync("src/lib/operations.ts", "utf8");
    expect(operations.match(/await requireOwner\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    const migration = readFileSync("supabase/migrations/20260728000002_operations_platform.sql", "utf8");
    expect(migration).toContain('create policy "scoped task read"');
    expect(migration).toContain("public.app_create_task(text, text, uuid, uuid, uuid");
    expect(migration).toContain("to service_role");
  });
  it("uses the persisted canonical client slug after creation", () => {
    const action = readFileSync("src/app/(platform)/clients/actions.ts", "utf8");
    expect(action).toContain("input.slug.trim().toLowerCase()");
    expect(action).toContain("encodeURIComponent");
    expect(readFileSync("src/app/(platform)/clients/[id]/page.tsx", "utf8")).toContain('.eq("slug", slug)');
  });
  it("generates simple accent-safe client slugs", () => {
    expect(clientSlugFromName("VYŌ Studios")).toBe("vyo-studios");
    expect(clientSlugFromName("  North & South  ")).toBe("north-south");
  });
});
