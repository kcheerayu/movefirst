import { notFound } from "next/navigation";
import { ClientForm } from "@/components/clients/client-form";
import { updateClientAction } from "../actions";
import { getCurrentContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAccessClient } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";
export default async function Client({ params }: { params: Promise<{ id: string }> }) {
  const { id: slug } = await params; const context = await getCurrentContext(); if (!context) notFound();
  const admin = createAdminClient(); const { data: client } = await admin.from("clients").select("id,slug,name,website,industry,description,status,client_members(user_id),client_agent_access(agent_id)").eq("slug", slug).maybeSingle();
  if (!client || !canAccessClient(context, client.id)) notFound();
  const canManage = context.permissions.includes("clients.manage");
  const [{ data: users }, { data: agents }] = await Promise.all([canManage ? admin.from("profiles").select("id,full_name").eq("status", "active").order("full_name") : Promise.resolve({data: []}), canManage ? admin.from("agents").select("id,name").eq("enabled",true).order("name") : Promise.resolve({data: []})]);
  return <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8"><p className="text-xs tracking-[.16em] text-[#8d8f88]">CLIENT WORKSPACE</p><h1 className="mt-3 text-3xl tracking-tight">{client.name}</h1><p className="mt-3 max-w-2xl text-[#a8a9a2]">{client.description || "Shared context for agent work, campaigns, documents and activity."}</p>{canManage ? <ClientForm action={updateClientAction} client={{...client,userIds:client.client_members.map(x=>x.user_id),agentIds:client.client_agent_access.map(x=>x.agent_id)}} users={(users??[]).map(x=>({id:x.id,name:x.full_name}))} agents={agents??[]}/> : <div className="mt-10 border border-[#2b2d29] bg-[#171815] p-6"><p className="text-sm text-[#a8a9a2]">Your assigned client workspace is ready for connected agent context.</p></div>}</div>;
}
