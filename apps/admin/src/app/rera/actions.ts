"use server";

import { revalidatePath } from "next/cache";

import { apiFetch } from "@/lib/api";

export interface ReraFormState {
  error?: string;
  saved?: string;
}

export async function saveRegistration(
  _prev: ReraFormState,
  form: FormData,
): Promise<ReraFormState> {
  const state = String(form.get("state") ?? "").trim();
  const registrationNo = String(form.get("registrationNo") ?? "").trim();
  const authorityName = String(form.get("authorityName") ?? "").trim();
  const validUntil = String(form.get("validUntil") ?? "").trim();

  if (!state || !registrationNo) {
    return { error: "Enter the registration number." };
  }

  const result = await apiFetch(`/staff/rera/${encodeURIComponent(state)}`, {
    method: "PUT",
    body: JSON.stringify({
      registrationNo,
      authorityName,
      ...(validUntil ? { validUntil } : {}),
    }),
  });

  if (!result.ok) return { error: result.error ?? "Could not save." };

  revalidatePath("/rera");
  // Revalidated too: a newly-added registration unblocks publishing in that jurisdiction, and the
  // listing form's error state should not survive the fix.
  revalidatePath("/listings");
  return { saved: state };
}
