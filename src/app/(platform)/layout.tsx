import { redirect } from "next/navigation"; import { getCurrentContext } from "@/lib/auth/context"; import { AppShell } from "@/components/layout/app-shell";
export const dynamic = "force-dynamic";
export default async function PlatformLayout({children}:{children:React.ReactNode}){const context=await getCurrentContext();if(!context)redirect("/login");return <AppShell context={context}>{children}</AppShell>}
