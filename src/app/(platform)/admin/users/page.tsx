import { DeleteUserButton } from "@/components/admin/delete-user-button";
import { EditUserAccessForm } from "@/components/admin/edit-user-access-form";
import { InviteUserForm } from "@/components/admin/invite-user-form";
import { requireOwner } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { updateUserStatusAction } from "./actions";

export const dynamic = "force-dynamic";
type Relation = { name: string } | { name: string }[];
type UserRow = { id:string; full_name:string; job_title:string|null; status:string; last_active_at:string|null; roles:{key:string}|{key:string}[]; user_agent_access:{agent_id:string;agents:Relation}[]; client_members:{client_id:string;clients:Relation}[] };
const names = (items:{agents?:Relation;clients?:Relation}[], key:"agents"|"clients") => items.flatMap(item => { const relation=item[key]; return Array.isArray(relation) ? relation.map(x=>x.name) : relation ? [relation.name] : []; }).join(", ") || "—";

export default async function Users() {
  await requireOwner();
  const admin = createAdminClient();
  const [{data:users,error:usersError},{data:agentChoices},{data:clientChoices}] = await Promise.all([
    admin.from("profiles").select("id,full_name,job_title,status,last_active_at,roles(key),user_agent_access(agent_id,agents(name)),client_members(client_id,clients(name))").order("created_at",{ascending:false}),
    admin.from("agents").select("id,name").eq("enabled",true).order("name"),
    admin.from("clients").select("id,name").is("archived_at",null).order("name"),
  ]);
  if (usersError) throw new Error("Unable to load users.");
  return <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
    <div className="flex justify-between"><div><p className="text-xs tracking-[.16em] text-[#8d8f88]">ADMINISTRATION</p><h1 className="mt-3 text-3xl tracking-tight">Users</h1></div><InviteUserForm agents={agentChoices??[]} clients={clientChoices??[]}/></div>
    <div className="mt-10 overflow-x-auto border border-[#2b2d29]"><table className="w-full min-w-[840px] text-left"><thead className="border-b border-[#2b2d29] text-xs tracking-[.12em] text-[#898b84]"><tr><th className="p-4">NAME</th><th>ROLE</th><th>AGENTS</th><th>CLIENTS</th><th>STATUS</th><th>LAST ACTIVE</th><th/></tr></thead><tbody>{(users as UserRow[]).map(user=>{
      const role=Array.isArray(user.roles)?user.roles[0]?.key:user.roles?.key;
      return <tr className="border-b border-[#2b2d29] last:border-0" key={user.id}><td className="p-4"><p>{user.full_name}</p><p className="mt-1 text-xs text-[#777971]">{user.job_title??"—"}</p></td><td>{role}</td><td className="max-w-40 text-sm text-[#a8a9a2]">{names(user.user_agent_access,"agents")}</td><td className="max-w-40 text-sm text-[#a8a9a2]">{names(user.client_members,"clients")}</td><td className={user.status==="active"?"text-[#b8bd9f]":"text-[#e4b94e]"}>{user.status}</td><td className="text-xs text-[#898b84]">{user.last_active_at?new Date(user.last_active_at).toLocaleDateString():"Never"}</td><td className="pr-4">{role!=="OWNER"&&<><EditUserAccessForm user={{id:user.id,name:user.full_name,role:role??"MEMBER",agentIds:user.user_agent_access.map(x=>x.agent_id),clientIds:user.client_members.map(x=>x.client_id)}} agents={agentChoices??[]} clients={clientChoices??[]}/><form className="inline" action={updateUserStatusAction.bind(null,user.id,user.status==="disabled"?"active":"disabled")}><button className="text-xs text-[#a8a9a2] underline underline-offset-4">{user.status==="disabled"?"Reactivate":"Deactivate"}</button></form><DeleteUserButton userId={user.id} name={user.full_name}/></>}</td></tr>;
    })}</tbody></table></div>
  </div>;
}
