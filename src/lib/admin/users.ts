import "server-only";

import { z } from "zod";
import { requireOwner } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const roleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"]);
const ids = z.array(z.string().uuid()).default([]);
const accessSchema = z.object({ agentIds: ids, clientIds: ids });
const updateAccessSchema = z.object({ role: roleSchema, ...accessSchema.shape });
export const inviteUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  role: roleSchema,
  jobTitle: z.string().trim().max(120).optional().or(z.literal("")),
  ...accessSchema.shape,
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

function rpcError(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

export async function inviteUser(input: InviteUserInput, redirectTo: string) {
  const actor = await requireOwner();
  const values = inviteUserSchema.parse(input);
  const admin = createAdminClient();
  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(values.email, {
    redirectTo,
    data: { full_name: values.fullName },
  });
  if (inviteError || !invite.user) rpcError(inviteError, "Unable to send invitation.");

  const { error: metadataError } = await admin.auth.admin.updateUserById(invite.user.id, {
    app_metadata: { move_first_initial_password_required: true },
  });
  if (metadataError) {
    await admin.auth.admin.deleteUser(invite.user.id, false);
    rpcError(metadataError, "Invitation could not be secured and was rolled back.");
  }

  const { error: provisionError } = await admin.rpc("app_provision_invited_user", {
    target_user_id: invite.user.id,
    target_full_name: values.fullName,
    target_job_title: values.jobTitle || "",
    target_role_key: values.role,
    target_agent_ids: values.agentIds,
    target_client_ids: values.clientIds,
    actor_user_id: actor.user.id,
  });
  if (provisionError) {
    const { error: rollbackError } = await admin.auth.admin.deleteUser(invite.user.id, false);
    if (rollbackError) {
      throw new Error("Invitation identity was created but provisioning failed; manual cleanup is required.");
    }
    rpcError(provisionError, "Invitation could not be provisioned and was rolled back.");
  }
}

export async function setUserStatus(userId: string, status: "active" | "disabled") {
  const actor = await requireOwner();
  if (userId === actor.user.id && status === "disabled") throw new Error("An owner cannot deactivate their own account.");
  const admin = createAdminClient();

  // Disable the identity first when reactivating, and the profile first when disabling.
  // Either failure remains fail-closed: a disabled profile can never access the platform.
  if (status === "active") {
    const { error: unbanError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
    if (unbanError) rpcError(unbanError, "Unable to reactivate the identity.");
  }
  const { error: statusError } = await admin.rpc("app_set_user_status", {
    target_user_id: userId,
    target_status: status,
    actor_user_id: actor.user.id,
  });
  if (statusError) rpcError(statusError, "Unable to update user status.");
  if (status === "disabled") {
    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (banError) {
      throw new Error("The platform profile was disabled and database sessions were revoked, but the Supabase identity ban failed. Retry this action.");
    }
  }
}

export async function updateUserAccess(userId: string, input: { role: "OWNER" | "ADMIN" | "MEMBER"; agentIds: string[]; clientIds: string[] }) {
  const actor = await requireOwner();
  const values = updateAccessSchema.parse(input);
  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin.from("profiles").select("roles!inner(key)").eq("id", userId).single();
  if (targetError || !target) throw new Error("User not found.");
  const targetRole = (target.roles as unknown as { key: string }).key;
  if (targetRole === "OWNER" && userId !== actor.user.id) throw new Error("Owner privileges cannot be changed here.");
  if (userId === actor.user.id && values.role !== "OWNER") throw new Error("An owner cannot remove their own owner role.");
  const { error } = await admin.rpc("app_replace_user_access", {
    target_user_id: userId,
    target_role_key: values.role,
    target_agent_ids: values.agentIds,
    target_client_ids: values.clientIds,
    actor_user_id: actor.user.id,
  });
  if (error) rpcError(error, "Unable to save access.");
}

export async function deleteUser(userId: string) {
  const actor = await requireOwner();
  if (userId === actor.user.id) throw new Error("An owner cannot delete their own account.");
  const admin = createAdminClient();
  const { data: target, error: targetError } = await admin.from("profiles").select("roles!inner(key)").eq("id", userId).single();
  if (targetError || !target) throw new Error("User not found.");
  if ((target.roles as unknown as { key: string }).key === "OWNER") throw new Error("Owner accounts cannot be deleted here.");
  const { error: auditError } = await admin.from("activity_logs").insert({ actor_id: actor.user.id, action: "USER_DELETED", entity_type: "profile", entity_id: userId });
  if (auditError) throw new Error("Unable to record deletion audit event.");
  const { error } = await admin.auth.admin.deleteUser(userId, false);
  if (error) throw new Error("Deletion was audited but the Auth identity could not be removed. Retry this action.");
}
