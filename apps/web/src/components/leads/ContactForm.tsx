"use client";

import { useState } from "react";

import { submitLead } from "@/lib/leads/submit";

/**
 * General contact form.
 *
 * The "what brings you here?" selector exists purely so the lead can be routed and prioritised
 * correctly — a seller enquiry and a general question deserve very different response times, and
 * asking outright is more reliable than inferring from a free-text message.
 */

const INTENTS = [
  "I'm looking to buy",
  "I'm thinking of selling",
  "Both — buying and selling",
  "General question",
];

export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  /* Holds the SERVER's wording, so a fixable mistake ("Enter a valid Indian mobile number") is
   * shown instead of a generic apology. See lib/leads/submit.ts. */
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");

    const formData = new FormData(event.currentTarget);
    const intent = formData.get("intent");

    const problem = await submitLead({
      type: "contact",
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      // Intent is folded into the message so it survives into any CRM without a custom field.
      message: `[${intent}] ${formData.get("message")}`,
    });

    if (problem) {
      setStatus("error");
      setError(problem);
      return;
    }
    setStatus("success");
  }

  if (status === "success") {
    return (
      <div className="rounded-card border border-brand-200 bg-brand-50 p-8">
        <h2 className="font-display text-2xl font-semibold text-brand-900">Message sent</h2>
        <p className="mt-3 leading-relaxed text-brand-800">
          Thanks for reaching out — I&rsquo;ll get back to you shortly. If it&rsquo;s time
          sensitive, calling is always faster.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-card border border-sand-200 bg-white p-6 sm:p-8"
    >
      <h2 className="font-display text-2xl font-semibold text-sand-950">Send a message</h2>

      <div className="mt-6 space-y-4">
        <div>
          <label htmlFor="intent" className="block text-sm font-medium text-sand-800">
            What brings you here?
          </label>
          <select
            id="intent"
            name="intent"
            defaultValue={INTENTS[0]}
            className="mt-1.5 w-full rounded-md border border-sand-300 px-3 py-2.5 text-sm text-sand-900"
          >
            {INTENTS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <Input name="name" label="Name" required autoComplete="name" />
        <Input name="email" label="Email" type="email" required autoComplete="email" />
        <Input name="phone" label="Phone" type="tel" autoComplete="tel" hint="Optional" />

        <div>
          <label htmlFor="message" className="block text-sm font-medium text-sand-800">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            rows={5}
            required
            placeholder="Tell me what you're looking for, or ask me anything."
            className="mt-1.5 w-full rounded-md border border-sand-300 px-3 py-2 text-sm text-sand-900 focus:border-brand-600 focus:outline-none"
          />
        </div>

        {status === "error" && (
          <p role="alert" className="text-sm text-clay-700">
            {error ?? "Something went wrong. Please try again, or call instead."}
          </p>
        )}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="w-full rounded-md bg-brand-700 px-6 py-3.5 text-base font-semibold text-white transition-colors hover:bg-brand-800 disabled:opacity-60"
        >
          {status === "submitting" ? "Sending…" : "Send message"}
        </button>
      </div>
    </form>
  );
}

function Input({
  name,
  label,
  type = "text",
  required = false,
  autoComplete,
  hint,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-sand-800">
        {label}
        {hint && <span className="ml-1.5 text-xs font-normal text-sand-500">{hint}</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        className="mt-1.5 w-full rounded-md border border-sand-300 px-3 py-2.5 text-sm text-sand-900 focus:border-brand-600 focus:outline-none"
      />
    </div>
  );
}
