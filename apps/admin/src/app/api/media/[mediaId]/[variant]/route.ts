import { apiFetchRaw } from "@/lib/api";

/**
 * Stream a photo variant through the admin's session.
 *
 * ⚠️ A DRAFT LISTING'S PHOTOS ARE NOT PUBLIC, so the admin cannot point <img> at the API's public
 * media route — that route resolves the row under an ANONYMOUS context, and RLS correctly returns
 * nothing for unpublished inventory. The agent's own drafts would render as broken images, which
 * looks exactly like a failed upload.
 *
 * Going through here attaches the staff token, so the same RLS check resolves in the agent's
 * favour for their own listings and still refuses another organisation's.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string; variant: string }> },
) {
  const { mediaId, variant } = await params;

  const upstream = await apiFetchRaw(`/media/${encodeURIComponent(mediaId)}/${encodeURIComponent(variant)}`, {
    headers: { accept: "image/*" },
  });

  if (!upstream.ok || !upstream.body) return new Response(null, { status: upstream.status });

  // Streamed, not buffered — see apiFetchRaw. Cache-Control is deliberately weaker than the
  // public route's `immutable`: an agent who replaces a photo should see the change immediately,
  // and admin traffic is one user, so there is nothing to gain from a long cache.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "image/webp",
      "cache-control": "private, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
}
