import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { ApiLeadStore } from "./api-store";
import { scoreLead } from "./scoring";
import type { Lead, LeadInput } from "./types";

/**
 * Lead persistence.
 *
 * Same pattern as ListingProvider: an interface, so the destination can change without touching
 * the forms or the route handler.
 *
 *   Development:  FileLeadStore — append-only JSONL on disk, no API needed
 *   Anywhere real: ApiLeadStore — Postgres, via the NestJS lead intake
 *   Later:        a CRM (Follow Up Boss, Sierra, HubSpot) behind the same interface
 *
 * ⚠️ A LOST LEAD IS LOST REVENUE, and `FileLeadStore` loses them on any host with an ephemeral
 * filesystem — Vercel, Cloud Run, any rescheduled container. The write succeeds, the form says
 * "thank you", and the record is gone at the next deploy. `getLeadStore()` therefore REFUSES to
 * return it in production rather than trusting anyone to remember.
 */

export interface LeadStore {
  readonly name: string;
  create(input: LeadInput): Promise<Lead>;
  list(): Promise<Lead[]>;
}

/** Kept out of the web root and git — leads are personal data. */
const DATA_DIR = path.join(process.cwd(), ".data");
const LEADS_FILE = path.join(DATA_DIR, "leads.jsonl");

export class FileLeadStore implements LeadStore {
  readonly name = "FileLeadStore (.data/leads.jsonl)";

  async create(input: LeadInput): Promise<Lead> {
    const lead: Lead = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      score: scoreLead(input),
      status: "new",
    };

    await mkdir(DATA_DIR, { recursive: true });
    // JSONL: one record per line, so appends are atomic-ish and the file stays greppable.
    await appendFile(LEADS_FILE, `${JSON.stringify(lead)}\n`, "utf8");

    return lead;
  }

  async list(): Promise<Lead[]> {
    try {
      const contents = await readFile(LEADS_FILE, "utf8");
      return contents
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as Lead;
          } catch {
            // Tolerate a truncated final line from an interrupted write rather than
            // failing the whole read — one damaged record shouldn't hide the rest.
            return null;
          }
        })
        .filter((lead): lead is Lead => lead !== null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error) {
      // No file yet simply means no leads.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

let store: LeadStore | null = null;

/**
 * ⚠️ FAILS LOUDLY IN PRODUCTION RATHER THAN FALLING BACK TO THE FILE STORE.
 *
 * The tempting default — "use the API if configured, otherwise write to disk" — is exactly wrong
 * here. A missing `API_URL` in a production deploy would then look completely healthy: forms
 * submit, users are thanked, and every lead is written to a filesystem that will not survive the
 * next deploy. Nobody discovers it until the agent asks why the enquiries stopped.
 *
 * Crashing on boot is recoverable in minutes. Silently dropping leads is not recoverable at all.
 */
export function getLeadStore(): LeadStore {
  if (store) return store;

  const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;

  if (apiUrl) {
    store = new ApiLeadStore(apiUrl);
    return store;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "API_URL is not set, so leads would be written to an ephemeral local file and lost on the " +
        "next deploy. Set API_URL to the catalog/lead API before serving traffic.",
    );
  }

  store = new FileLeadStore();
  return store;
}
