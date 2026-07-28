import "server-only";
import { getCurrentContext } from "@/lib/auth/context";

export async function requireOwner() {
  const context = await getCurrentContext();
  if (!context || context.user.role !== "OWNER" || !context.permissions.includes("platform.manage")) throw new Error("Owner access required");
  return context;
}
