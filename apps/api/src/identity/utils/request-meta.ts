import type { Request } from "express";

/**
 * Pull the client's address and user agent for the session record.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy we control — Express must be configured
 * with `trust proxy` for `req.ip` to honour it. Recorded for AUDIT ONLY, never for authorisation:
 * both values are client-supplied, and a session that trusted them could be relocated by forging
 * a header.
 *
 * Shared by both auth controllers rather than duplicated — otherwise the two session records
 * drift, and "why does the staff audit trail have a user agent when the consumer one doesn't"
 * becomes a question somebody has to answer at an awkward moment.
 */
export function requestMeta(request: Request) {
  return {
    userAgent: request.headers["user-agent"]?.slice(0, 512),
    ip: request.ip,
  };
}
