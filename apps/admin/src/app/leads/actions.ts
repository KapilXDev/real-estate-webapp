"use server";

import { revalidatePath } from "next/cache";

import { apiFetch } from "@/lib/api";

export async function setLeadStatus(leadId: string, status: string, note?: string) {
  const result = await apiFetch(`/staff/leads/${leadId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, note }),
  });

  revalidatePath("/leads");
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
