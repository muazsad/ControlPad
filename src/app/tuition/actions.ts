"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

export async function setPaymentStatus(
  studentId: string,
  periodMonth: string,
  _prevState: { error: string } | undefined,
  formData: FormData,
): Promise<{ error: string } | undefined> {
  const profile = await requireRole(["admin"]);
  const newStatus = formData.get("newStatus") as "paid" | "unpaid";

  if (newStatus !== "paid" && newStatus !== "unpaid") {
    return { error: "Invalid status value." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("payments").upsert(
    {
      student_id: studentId,
      period_month: periodMonth,
      status: newStatus,
      paid_at: newStatus === "paid" ? new Date().toISOString() : null,
      recorded_by: profile.id,
    },
    { onConflict: "student_id,period_month" },
  );

  if (error) return { error: error.message };

  revalidatePath("/tuition");
}
