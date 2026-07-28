"use client";
import { useTransition } from "react";
import { deleteUserAction } from "@/app/(platform)/admin/users/actions";
export function DeleteUserButton({userId,name}:{userId:string;name:string}){const [pending,startTransition]=useTransition();return <button type="button" onClick={()=>{if(confirm(`Delete ${name}? This permanently removes their login and access.`))startTransition(async()=>{await deleteUserAction(userId);});}} disabled={pending} className="ml-3 text-xs text-[#f18b8b] underline underline-offset-4 disabled:opacity-60">{pending?"Deleting…":"Delete"}</button>}
