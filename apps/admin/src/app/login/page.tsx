"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

/**
 * Staff sign-in.
 *
 * A client component because it posts to the login route handler and needs to show an inline
 * error without a full page reload. The credentials go to our own origin, never to the API
 * directly — the browser must not learn the API's address or hold a token.
 */
function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not sign in.");
        return;
      }

      /*
       * ⚠️ `from` is used as a PATH ONLY, and rejected unless it starts with a single slash.
       * Middleware sets it, but a crafted link could set it to anything — `//evil.example` is a
       * protocol-relative URL that most routers treat as absolute, which turns the login page
       * into an open redirect that phishing can point at.
       */
      const from = params.get("from");
      const safeFrom = from && /^\/(?!\/)/.test(from) ? from : "/listings";

      router.replace(safeFrom);
      // The session cookie was set by the handler; refresh so Server Components re-read it.
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-sand-950">Tricity Estate</h1>
        <p className="mt-1 text-sm text-sand-600">Sign in to manage listings and enquiries.</p>
      </div>

      {error && (
        <p
          // Announced to screen readers — a sighted user sees the colour change, and a keyboard
          // user who just submitted needs to hear why nothing happened.
          role="alert"
          className="rounded-card border border-clay-300 bg-clay-100 px-3 py-2 text-sm text-clay-700"
        >
          {error}
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="email" className="block text-sm font-medium text-sand-800">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-card border border-sand-300 bg-white px-3 py-2 text-sand-950"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium text-sand-800">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          // Tells a password manager this is a sign-in rather than a new credential.
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-card border border-sand-300 bg-white px-3 py-2 text-sand-950"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-card bg-brand-700 px-4 py-2.5 font-medium text-white hover:bg-brand-800 disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      {/* useSearchParams needs a Suspense boundary or the whole route opts out of prerendering. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
