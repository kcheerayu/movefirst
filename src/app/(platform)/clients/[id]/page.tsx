import { notFound } from "next/navigation";
import { ClientForm } from "@/components/clients/client-form";
import { ProjectForm } from "@/components/operations/project-form";
import { TaskForm } from "@/components/operations/task-form";
import { updateClientAction } from "../actions";
import { addClientNoteAction, createProjectAction, createTaskAction } from "../../operations-actions";
import { getCurrentContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessClient } from "@/lib/auth/scope";
import { getProjects, getTasks } from "@/lib/operations";
import { getActivity, metadataSummary } from "@/lib/data/activity";
import { isOverdue } from "@/lib/operations-math";

export const dynamic = "force-dynamic";
type Member = { user_id: string; assignment_role: string; profiles: { full_name: string } | { full_name: string }[] | null };
const profileName = (relation: Member["profiles"]) => (Array.isArray(relation) ? relation[0] : relation)?.full_name;
const noteAuthor = (relation: { full_name: string } | { full_name: string }[] | null) => (Array.isArray(relation) ? relation[0] : relation)?.full_name ?? "Team";

export default async function Client({ params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params;
  const context = await getCurrentContext();
  if (!context) notFound();
  const admin = createAdminClient();
  const { data: client } = await admin.from("clients").select("id,slug,name,website,industry,description,primary_contact,contact_email,contact_phone,status,client_members(user_id,assignment_role,profiles(full_name)),client_agent_access(agent_id)").eq("slug", slug).maybeSingle();
  if (!client || !canAccessClient(context, client.id)) notFound();
  const canManage = context.permissions.includes("clients.manage");
  const [projects, tasks, activity, notesResult, usersResult, agentsResult] = await Promise.all([
    getProjects(context, client.id), getTasks(context, { clientId: client.id }), context.permissions.includes("activity.read") ? getActivity(context, {}, 150) : [],
    admin.from("client_notes").select("id,body,created_at,author:profiles!client_notes_author_id_fkey(full_name)").eq("client_id", client.id).order("created_at", { ascending: false }),
    canManage ? admin.from("profiles").select("id,full_name").eq("status", "active").order("full_name") : Promise.resolve({ data: [] }),
    canManage ? admin.from("agents").select("id,name").eq("enabled", true).order("name") : Promise.resolve({ data: [] }),
  ]);
  const users = (usersResult.data ?? []).map((user) => ({ id: user.id, name: user.full_name }));
  const members = client.client_members as Member[];
  const relevantActivity = activity.filter((row) => row.metadata.client_id === client.id).slice(0, 20);
  const clientFormData = { ...client, userIds: members.map((member) => member.user_id), agentIds: client.client_agent_access.map((grant) => grant.agent_id) };

  return <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs tracking-[.16em] text-[#8d8f88]">CLIENT WORKSPACE</p><h1 className="mt-3 text-3xl tracking-tight">{client.name}</h1><p className="mt-3 max-w-2xl text-[#a8a9a2]">{client.description || "A shared command center for client work, deliverables, notes, and ownership."}</p></div><span className="border border-[#343630] px-2 py-1 text-xs tracking-[.12em]">{client.status}</span></div>
    <section className="mt-10 grid gap-4 border-y border-[#2b2d29] py-6 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-[11px] tracking-[.12em] text-[#777971]">CONTACT</p><p className="mt-2">{client.primary_contact || "Not set"}</p><p className="mt-1 text-sm text-[#898b84]">{client.contact_email || client.contact_phone || "No contact details"}</p></div><div><p className="text-[11px] tracking-[.12em] text-[#777971]">WEBSITE</p><p className="mt-2 text-sm">{client.website || "Not set"}</p></div><div><p className="text-[11px] tracking-[.12em] text-[#777971]">INDUSTRY</p><p className="mt-2 text-sm">{client.industry || "Not set"}</p></div><div><p className="text-[11px] tracking-[.12em] text-[#777971]">WORK</p><p className="mt-2 text-sm">{projects.length} projects · {tasks.filter((task) => task.status !== "DONE").length} open tasks</p></div></section>
    <section className="mt-12 grid gap-8 lg:grid-cols-[1.2fr_.8fr]"><div><div className="flex items-center justify-between"><h2 className="text-xs tracking-[.16em] text-[#a8a9a2]">PROJECTS</h2>{canManage && <details><summary className="cursor-pointer text-xs text-[#b8bd9f]">Add project</summary><div className="mt-3 w-[min(660px,80vw)]"><ProjectForm action={createProjectAction} fixedClientId={client.id} clients={[]} users={users}/></div></details>}</div><div className="mt-4 divide-y divide-[#2b2d29] border-y border-[#2b2d29]">{projects.length ? projects.map((project) => <div className="py-4" key={project.id}><p>{project.name}</p><p className="mt-1 text-sm text-[#898b84]">{project.status.replace("_", " ")} · due {project.due_date ?? "not set"}</p></div>) : <p className="py-5 text-sm text-[#898b84]">No projects yet.</p>}</div><div className="mt-10 flex items-center justify-between"><h2 className="text-xs tracking-[.16em] text-[#a8a9a2]">TASKS</h2>{canManage && <details><summary className="cursor-pointer text-xs text-[#b8bd9f]">Add task</summary><div className="mt-3 w-[min(660px,80vw)]"><TaskForm action={createTaskAction} fixedClientId={client.id} clients={[]} projects={projects} users={users}/></div></details>}</div><div className="mt-4 divide-y divide-[#2b2d29] border-y border-[#2b2d29]">{tasks.length ? tasks.map((task) => <div className="flex items-start justify-between gap-4 py-4" key={task.id}><div><p>{task.title}</p><p className="mt-1 text-sm text-[#898b84]">{task.assignee?.full_name || "Unassigned"} · {task.status.replace("_", " ")}</p></div><span className={isOverdue(task) ? "text-xs text-[#f1a28d]" : "text-xs text-[#777971]"}>{task.due_date || "No deadline"}</span></div>) : <p className="py-5 text-sm text-[#898b84]">No tasks yet.</p>}</div></div>
    <aside><h2 className="text-xs tracking-[.16em] text-[#a8a9a2]">TEAM</h2><div className="mt-4 divide-y divide-[#2b2d29] border-y border-[#2b2d29]">{members.length ? members.map((member) => <div className="flex justify-between py-3 text-sm" key={member.user_id}><span>{profileName(member.profiles) || "Team member"}</span><span className="text-[#898b84]">{member.assignment_role}</span></div>) : <p className="py-4 text-sm text-[#898b84]">No team members assigned.</p>}</div><h2 className="mt-10 text-xs tracking-[.16em] text-[#a8a9a2]">NOTES</h2>{canManage && <form action={addClientNoteAction} className="mt-4"><input type="hidden" name="clientId" value={client.id}/><textarea required name="body" placeholder="Add an internal note" className="min-h-24 w-full border border-[#343630] bg-[#171815] p-3 text-sm"/><button className="mt-2 bg-[#c8f54b] px-3 py-2 text-xs font-medium text-[#10110f]">Save note</button></form>}<div className="mt-4 space-y-3">{(notesResult.data ?? []).map((note) => <article className="border border-[#2b2d29] bg-[#171815] p-3 text-sm" key={note.id}><p>{note.body}</p><p className="mt-2 text-xs text-[#777971]">{noteAuthor(note.author as unknown as { full_name: string } | { full_name: string }[] | null)} · {new Date(note.created_at).toLocaleDateString()}</p></article>)}{!notesResult.data?.length && <p className="text-sm text-[#898b84]">No internal notes yet.</p>}</div></aside></section>
    <section className="mt-12"><h2 className="text-xs tracking-[.16em] text-[#a8a9a2]">ACTIVITY</h2><div className="mt-4 divide-y divide-[#2b2d29] border-y border-[#2b2d29]">{relevantActivity.length ? relevantActivity.map((row) => <div className="flex justify-between gap-4 py-3 text-sm" key={row.id}><div><p>{row.action.replaceAll("_", " ")}</p><p className="mt-1 text-[#898b84]">{metadataSummary(row.metadata)}</p></div><time className="text-xs text-[#777971]">{new Date(row.created_at).toLocaleDateString()}</time></div>) : <p className="py-5 text-sm text-[#898b84]">No visible activity for this client yet.</p>}</div></section>
    {canManage && <details className="mt-12"><summary className="cursor-pointer border border-[#343630] px-4 py-3 text-sm">Edit client and assignments</summary><ClientForm action={updateClientAction} client={clientFormData} users={users} agents={agentsResult.data ?? []}/></details>}
  </div>;
}
