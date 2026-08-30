"use client";

import { useActionState } from "react";

import { saveRegistration, type ReraFormState } from "@/app/rera/actions";
import type { ReraRegistration } from "@/app/rera/page";

/**
 * One jurisdiction's registration.
 *
 * A form per authority rather than one combined form: they are independent facts, an agent
 * typically holds one and applies for the next, and a single form would imply they must all be
 * filled in together.
 */
export function ReraForm({
  jurisdiction,
  existing,
}: {
  jurisdiction: { state: string; authority: string; covers: string };
  existing: ReraRegistration | null;
}) {
  const [state, formAction, pending] = useActionState<ReraFormState, FormData>(
    saveRegistration,
    {},
  );

  /*
   * ⚠️ An expired registration is treated as ABSENT by the API, not as a warning — an expired
   * number in an advertisement is a false claim of registration, which is worse than none because
   * it looks verified until someone checks the register. So the UI has to say plainly that
   * publishing is blocked, rather than showing a soft "expired" note next to a number that looks
   * present.
   */
  const expired =
    existing?.validUntil != null && new Date(existing.validUntil) < new Date();

  return (
    <form
      action={formAction}
      className="rounded-card border border-sand-200 bg-white p-5"
    >
      <input type="hidden" name="state" value={jurisdiction.state} />
      <input type="hidden" name="authorityName" value={jurisdiction.authority} />

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sand-950">{jurisdiction.state}</h2>
          <p className="text-sm text-sand-600">{jurisdiction.authority}</p>
          <p className="text-xs text-sand-500">Covers {jurisdiction.covers}</p>
        </div>

        {existing && !expired ? (
          <span className="rounded-full bg-status-active/10 px-2.5 py-0.5 text-xs font-medium text-status-active">
            Registered
          </span>
        ) : (
          <span className="rounded-full bg-clay-100 px-2.5 py-0.5 text-xs font-medium text-clay-700">
            {expired ? "Expired — publishing blocked" : "Not registered"}
          </span>
        )}
      </div>

      {!existing && (
        <p className="mb-4 rounded-card bg-sand-100 px-3 py-2 text-sm text-sand-700">
          You cannot publish listings in {jurisdiction.state} until this is filled in. Drafts are
          always allowed.
        </p>
      )}

      {state.error && (
        <p role="alert" className="mb-4 text-sm text-clay-700">
          {state.error}
        </p>
      )}
      {state.saved === jurisdiction.state && (
        <p className="mb-4 text-sm text-status-active">Saved.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block space-y-1 sm:col-span-2">
          <span className="block text-sm font-medium text-sand-800">Registration number</span>
          <input
            name="registrationNo"
            defaultValue={existing?.registrationNo ?? ""}
            placeholder="PBRERA-SAS81-AG-0042"
            className="w-full rounded-card border border-sand-300 bg-white px-3 py-2 font-mono text-sand-950"
            required
          />
          {/*
            No format validation anywhere in the stack, deliberately — the three authorities use
            different and undocumented formats and change them. This number's whole purpose is to
            be checkable against the public register, so it is stored exactly as issued.
          */}
          <span className="block text-xs text-sand-500">Exactly as issued.</span>
        </label>

        <label className="block space-y-1">
          <span className="block text-sm font-medium text-sand-800">Valid until</span>
          <input
            type="date"
            name="validUntil"
            defaultValue={existing?.validUntil ?? ""}
            className="w-full rounded-card border border-sand-300 bg-white px-3 py-2 text-sand-950"
          />
          <span className="block text-xs text-sand-500">Optional.</span>
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-card bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
      >
        {pending ? "Saving…" : existing ? "Update" : "Save"}
      </button>
    </form>
  );
}
