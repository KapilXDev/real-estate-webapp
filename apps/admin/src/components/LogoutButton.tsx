"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function signOut() {
    // The handler revokes the refresh token server-side before clearing the cookies — dropping
    // the cookie alone would leave a valid 30-day token alive on a shared machine.
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className="rounded-card px-3 py-1.5 text-sm text-sand-600 hover:bg-sand-100"
    >
      Sign out
    </button>
  );
}
