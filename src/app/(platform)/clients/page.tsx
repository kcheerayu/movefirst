import Link from "next/link";
import { ClientForm } from "@/components/clients/client-form";
import { createClientAction } from "./actions";
import { requirePermission } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export default async function Clients() {
  const context = await requirePermission("clients.read");
  const admin = createAdminClient();
  const canManage = context.permissions.includes("clients.manage");
  const [{ data: clients }, { data: users }, { data: agents }] = await Promise.all([
    canManage ? admin.from("clients").select("id,slug,name,industry,status").neq("status", "archived").order("name") : admin.from("clients").select("id,slug,name,industry,status").in("id", context.clientIds).neq("status", "archived").order("name"),
    canManage ? admin.from("profiles").select("id,full_name").eq("status", "active").order("full_name") : Promise.resolve({ data: [] }),
    canManage ? admin.from("agents").select("id,name").eq("enabled", true).order("name") : Promise.resolve({ data: [] }),
  ]);
  return <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8"><div><p className="text-xs tracking-[.16em] text-[#8d8f88]">WORKSPACE</p><h1 className="mt-3 text-3xl tracking-tight">Clients</h1></div>{canManage&&<ClientForm action={createClientAction} users={(users ?? []).map(x=>({id:x.id,name:x.full_name}))} agents={agents ?? []}/>}<div className="mt-10 border-y border-[#2b2d29]">{(clients ?? []).length ? clients?.map(client=><Link href={`/clients/${client.slug}`} className="flex items-center justify-between py-5 transition hover:px-2" key={client.id}><div><p className="font-medium">{client.name}</p><p className="mt-1 text-sm text-[#898b84]">{client.industry ?? "Client workspace"}</p></div><span className="text-xs text-[#b8bd9f]">{client.status.toUpperCase()}</span></Link>) : <p className="py-8 text-[#898b84]">No clients are available in your workspace.</p>}</div></div>;
}
