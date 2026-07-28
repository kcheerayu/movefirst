"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { inviteUser, setUserStatus } from "@/lib/admin/users";
import { deleteUser, updateUserAccess } from "@/lib/admin/users";

export type FormState={error?:string;success?:string};
export async function inviteUserAction(_previous:FormState, formData:FormData):Promise<FormState>{try{const headersList=await headers();const origin=headersList.get("origin")??process.env.NEXT_PUBLIC_SITE_URL;if(!origin)throw new Error("Application URL is not configured.");await inviteUser({fullName:String(formData.get("fullName")??""),email:String(formData.get("email")??""),role:String(formData.get("role")??"MEMBER") as "OWNER"|"ADMIN"|"MEMBER",jobTitle:String(formData.get("jobTitle")??""),agentIds:formData.getAll("agentIds").map(String),clientIds:formData.getAll("clientIds").map(String)},`${origin}/auth/callback`);revalidatePath("/admin/users");return {success:"Invitation sent and access provisioned."};}catch(error){return {error:error instanceof Error?error.message:"Unable to invite user."};}}
export async function updateUserStatusAction(userId:string,status:"active"|"disabled"){await setUserStatus(userId,status);revalidatePath("/admin/users");}
export async function updateUserAccessAction(_previous:FormState,formData:FormData):Promise<FormState>{try{await updateUserAccess(String(formData.get("userId")??""),{role:String(formData.get("role")??"MEMBER") as "OWNER"|"ADMIN"|"MEMBER",agentIds:formData.getAll("agentIds").map(String),clientIds:formData.getAll("clientIds").map(String)});revalidatePath("/admin/users");return {success:"Access updated."};}catch(error){return {error:error instanceof Error?error.message:"Unable to update access."};}}
export async function deleteUserAction(userId:string){await deleteUser(userId);revalidatePath("/admin/users");}
