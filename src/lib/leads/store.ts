import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { scoreLead } from "./scoring";
import type { Lead, LeadInput } from "./types";

/**
 * Lead persistence.
 *
 * Same pattern as ListingProvider: an interface with a simple implementation now, so the real
 * destination can be swapped in without touching the forms or API route.
 *
 *   Today:  FileLeadStore  — append-only JSONL on disk
 *   Later:  a real CRM (Follow Up Boss, Sierra, HubSpot) and/or Postgres
 *
 * A LOST LEAD IS LOST REVENUE, so the file store is append-only and never rewrites existing
 * records — a crash mid-write can at worst corrupt the newest line, not the whole history.
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

export function getLeadStore(): LeadStore {
  if (!store) store = new FileLeadStore();
  return store;
}
