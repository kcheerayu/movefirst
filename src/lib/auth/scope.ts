import type { AppContext, Permission } from "@/lib/types";
export const hasPermission=(context:AppContext|null,permission:Permission)=>Boolean(context?.user.status==="active"&&context.permissions.includes(permission));
export const canAccessClient=(context:AppContext,clientId:string)=>context.user.status==="active"&&(hasPermission(context,"clients.manage")||context.clientIds.includes(clientId));
export const canAccessAgent=(context:AppContext,agentId:string,slug:string)=>context.user.status==="active"&&(hasPermission(context,"agents.manage")||(context.agentIds.includes(agentId)&&context.agentSlugs.includes(slug)));
