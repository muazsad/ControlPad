"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { setLiveApprovalFor } from "@/lib/schools/platform-data";

/** Approve or revoke a school's live texting. Platform admins only. */
export async function setLiveApproval(
  schoolId: string,
  approve: boolean,
): Promise<{ error: string | null }> {
  const { userId } = await requirePlatformAdmin();
  const error = await setLiveApprovalFor(schoolId, approve ? userId : null);
  revalidatePath("/platform");
  return { error };
}
