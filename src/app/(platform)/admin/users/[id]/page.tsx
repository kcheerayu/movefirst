import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
type Relation = { name: string; slug: string } | { name: string; slug: string }[] | null;
const one = (value: Relation) => Array.isArray(value) ? value[0] : value;

export default async function MemberDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireOwner();
  const { id } = await params;
  const admin = createAdminClient();
  const [{ data: member }, { data: tasks }] = await Promise.all([
    admin.from("profiles").select("id,full_name,job_title,status,last_active_at,roles(key),client_members(client_id,clients(name,slug))").eq("id", id).maybeSingle(),
    admin.from("tasks").select("id,title,status,priority,due_date,clients(name,slug)").eq("assignee_id", id).neq("status", "DONE").order("due_date", { ascending: true, nullsFirst: false }),
  ]);
  if (!member) notFound();
  const roleRelation = member.roles as unknown as { key: string } | { key: string }[] | null;
  const role = Array.isArray(roleRelation) ? roleRelation[0]?.key : roleRelation?.key;
  return <div className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
    <Link href="/admin/users" className="text-xs text-[#b8bd9f]">← Team</Link>
    <p className="mt-8 text-xs tracking-[.16em] text-[#8d8f88]">TEAM MEMBER</p>
    <h1 className="mt-3 text-3xl tracking-tight">{member.full_name}</h1>
    <p className="mt-2 text-[#a8a9a2]">{member.job_title || "No title"} · {role} · {member.status}</p>
    <section className="mt-10 grid gap-8 md:grid-cols-2">
      <div><h2 className="text-xs tracking-[.16em] text-[#a8a9a2]">ASSIGNED CLIENTS</h2><div className="mt-4 divide-y divide-[#2b2d29] border-y border-[#2b2d29]">{member.client_members.length ? member.client_members.map((assignment) => { const client = one(assignment.clients as unknown as Relation); return client ? <Link className="block py-3 transition hover:text-[#c8f54b]" href={`/clients/${client.slug}`} key={assignment.client_id}>{client.name}</Link> : null; }) : <p className="py-4 text-sm text-[#898b84]">No client assignments.</p>}</div></div>
      <div><h2 className="text-xs tracking-[.16em] text-[#a8a9a2]">OPEN WORK</h2><div className="mt-4 divide-y divide-[#2b2d29] border-y border-[#2b2d29]">{(tasks ?? []).length ? tasks?.map((task) => { const client = one(task.clients as unknown as Relation); return <div className="py-3" key={task.id}><p>{task.title}</p><p className="mt-1 text-xs text-[#898b84]">{client?.name ?? "Client"} · {task.priority} · {task.due_date ?? "No deadline"}</p></div>; }) : <p className="py-4 text-sm text-[#898b84]">No open tasks.</p>}</div></div>
    </section>
  </div>;
}
