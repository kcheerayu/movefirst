import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RUN_SUPABASE_INTEGRATION === "true";
const suite = enabled ? describe : describe.skip;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const stamp = Date.now();
const memberEmail = `move-first-operations-${stamp}@example.invalid`;
const password = "Temporary-only-test-password-123";
let memberId = "", memberToken = "", clientId = "", otherClientId = "", duplicateClientId = "", projectId = "", taskId = "";
const serviceHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
async function request(path: string, init: RequestInit = {}, headers: Record<string, string> = serviceHeaders) { const response = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } }); return { response, body: await response.json().catch(() => null) }; }

suite("operations RLS", () => {
  beforeAll(async () => {
    const created = await request("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: memberEmail, password, email_confirm: true }) });
    if (!created.response.ok) throw new Error("Unable to create disposable operations member."); memberId = created.body.id;
    const role = await request("/rest/v1/roles?select=id&key=eq.MEMBER");
    await request("/rest/v1/profiles", { method: "POST", body: JSON.stringify({ id: memberId, full_name: "Operations Test", role_id: role.body[0].id, status: "active" }) });
    const createdClient = await request("/rest/v1/rpc/app_create_client", { method: "POST", body: JSON.stringify({ target_slug: `ops-client-${stamp}`, target_name: "Operations test client", target_website: "", target_industry: "", target_description: "", target_primary_contact: "", target_contact_email: "", target_contact_phone: "", target_user_ids: [memberId], target_agent_ids: [], actor_user_id: memberId }) });
    if (!createdClient.response.ok) throw new Error("Unable to create disposable operations client."); clientId = createdClient.body;
    const unrelated = await request("/rest/v1/clients", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ slug: `ops-other-${stamp}`, name: "Unrelated operations client" }) }); otherClientId = unrelated.body[0].id;
    const createdProject = await request("/rest/v1/rpc/app_create_project", { method: "POST", body: JSON.stringify({ target_client_id: clientId, target_name: "Operations project", target_description: "", target_status: "active", target_start_date: null, target_due_date: null, target_owner_id: memberId, actor_user_id: memberId }) });
    if (!createdProject.response.ok) throw new Error("Unable to create disposable project."); projectId = createdProject.body;
    const createdTask = await request("/rest/v1/rpc/app_create_task", { method: "POST", body: JSON.stringify({ target_title: "Operations task", target_description: "", target_client_id: clientId, target_project_id: projectId, target_assignee_id: memberId, target_priority: "HIGH", target_status: "TODO", target_due_date: "2026-07-30", actor_user_id: memberId }) });
    if (!createdTask.response.ok) throw new Error("Unable to create disposable task."); taskId = createdTask.body;
    const login = await request("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: memberEmail, password }) }, { apikey: anonKey, "Content-Type": "application/json" });
    if (!login.response.ok) throw new Error("Unable to authenticate disposable operations member."); memberToken = login.body.access_token;
  });
  afterAll(async () => { if (taskId) await request(`/rest/v1/tasks?id=eq.${taskId}`, { method: "DELETE" }); if (projectId) await request(`/rest/v1/projects?id=eq.${projectId}`, { method: "DELETE" }); if (clientId) await request(`/rest/v1/clients?id=eq.${clientId}`, { method: "DELETE" }); if (duplicateClientId) await request(`/rest/v1/clients?id=eq.${duplicateClientId}`, { method: "DELETE" }); if (otherClientId) await request(`/rest/v1/clients?id=eq.${otherClientId}`, { method: "DELETE" }); if (memberId) await request(`/auth/v1/admin/users/${memberId}`, { method: "DELETE" }); });
  it("returns only assigned project and task work to a MEMBER", async () => {
    const headers = { apikey: anonKey, Authorization: `Bearer ${memberToken}` };
    const projects = await request(`/rest/v1/projects?select=id&client_id=eq.${clientId}`, {}, headers);
    const tasks = await request(`/rest/v1/tasks?select=id&client_id=eq.${clientId}`, {}, headers);
    const unrelated = await request(`/rest/v1/projects?select=id&client_id=eq.${otherClientId}`, {}, headers);
    expect(projects.body).toHaveLength(1); expect(tasks.body).toHaveLength(1); expect(unrelated.body).toEqual([]);
  });
  it("records reassignment and completion through the server-only task lifecycle", async () => {
    const unassign = await request("/rest/v1/rpc/app_update_task", { method: "POST", body: JSON.stringify({ target_task_id: taskId, target_title: "Operations task", target_description: "", target_client_id: clientId, target_project_id: projectId, target_assignee_id: null, target_priority: "HIGH", target_status: "IN_PROGRESS", target_due_date: "2026-07-30", actor_user_id: memberId }) });
    const reassign = await request("/rest/v1/rpc/app_update_task", { method: "POST", body: JSON.stringify({ target_task_id: taskId, target_title: "Operations task", target_description: "", target_client_id: clientId, target_project_id: projectId, target_assignee_id: memberId, target_priority: "HIGH", target_status: "IN_PROGRESS", target_due_date: "2026-07-30", actor_user_id: memberId }) });
    const complete = await request("/rest/v1/rpc/app_update_task", { method: "POST", body: JSON.stringify({ target_task_id: taskId, target_title: "Operations task", target_description: "", target_client_id: clientId, target_project_id: projectId, target_assignee_id: memberId, target_priority: "HIGH", target_status: "DONE", target_due_date: "2026-07-30", actor_user_id: memberId }) });
    const task = await request(`/rest/v1/tasks?select=status,assignee_id,completed_at&id=eq.${taskId}`);
    const activity = await request(`/rest/v1/activity_logs?select=action&entity_id=eq.${taskId}`);
    expect(unassign.response.ok).toBe(true); expect(reassign.response.ok).toBe(true); expect(complete.response.ok).toBe(true); expect(task.body[0]).toMatchObject({ status: "DONE", assignee_id: memberId }); expect(task.body[0].completed_at).toBeTruthy(); expect(activity.body.map((row: { action: string }) => row.action)).toEqual(expect.arrayContaining(["TASK_REASSIGNED", "TASK_COMPLETED"]));
  });
  it("denies browser-side task mutations to a MEMBER", async () => {
    const headers = { apikey: anonKey, Authorization: `Bearer ${memberToken}`, "Content-Type": "application/json" };
    const write = await request("/rest/v1/tasks", { method: "POST", body: JSON.stringify({ title: "Forbidden", client_id: clientId, creator_id: memberId }) }, headers);
    const rpc = await request("/rest/v1/rpc/app_update_task", { method: "POST", body: JSON.stringify({}) }, headers);
    expect(write.response.ok).toBe(false); expect(rpc.response.ok).toBe(false);
  });
  it("stores a member submission and allows the OWNER workflow to complete it", async () => {
    const submission = await request("/rest/v1/rpc/app_submit_task_deliverable", { method: "POST", body: JSON.stringify({ target_task_id: taskId, target_external_url: "https://example.com/deliverable", target_note: "Completed and sent to client", actor_user_id: memberId }) });
    const submitted = await request(`/rest/v1/tasks?select=status&id=eq.${taskId}`);
    const record = await request(`/rest/v1/task_submissions?select=external_url,note,submitted_by&task_id=eq.${taskId}`);
    const complete = await request("/rest/v1/rpc/app_update_task", { method: "POST", body: JSON.stringify({ target_task_id: taskId, target_title: "Operations task", target_description: "", target_client_id: clientId, target_project_id: projectId, target_assignee_id: memberId, target_priority: "HIGH", target_status: "DONE", target_due_date: "2026-07-30", actor_user_id: memberId }) });
    expect(submission.response.ok).toBe(true); expect(submitted.body[0]?.status).toBe("SUBMITTED"); expect(record.body[0]).toMatchObject({ external_url: "https://example.com/deliverable", note: "Completed and sent to client", submitted_by: memberId }); expect(complete.response.ok).toBe(true);
  });
  it("allocates a safe suffix for duplicate simple client slugs", async () => {
    const first = await request("/rest/v1/rpc/app_create_client_simple", { method: "POST", body: JSON.stringify({ target_slug: `duplicate-${stamp}`, target_name: "Duplicate One", target_contact_name: "Contact", target_industry: "Marketing", actor_user_id: memberId }) });
    const second = await request("/rest/v1/rpc/app_create_client_simple", { method: "POST", body: JSON.stringify({ target_slug: `duplicate-${stamp}`, target_name: "Duplicate Two", target_contact_name: "Contact", target_industry: "Marketing", actor_user_id: memberId }) });
    duplicateClientId = second.body?.[0]?.id;
    expect(first.response.ok).toBe(true); expect(second.response.ok).toBe(true); expect(second.body?.[0]?.slug).toBe(`duplicate-${stamp}-2`);
    if (first.body?.[0]?.id) await request(`/rest/v1/clients?id=eq.${first.body[0].id}`, { method: "DELETE" });
  });
});
