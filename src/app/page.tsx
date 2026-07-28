import { redirect } from "next/navigation";
import { getCurrentContext } from "@/lib/auth/context";
import { APP_HOME } from "@/lib/navigation";
export default async function Home() { const context = await getCurrentContext(); redirect(context ? APP_HOME : "/login"); }
