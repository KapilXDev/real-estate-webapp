-- 0019: RLS on the two child tables that never got it
--
-- Found while adding lead status transitions: `lead_activity` and `listing_price_history` are
-- children of tenant-scoped tables but carry no policies of their own. Same class of gap as
-- `listing_media` in 0018, and invisible for the same reason — nothing had written to them yet.
--
-- ⚠️ A FOREIGN KEY TO A PROTECTED TABLE PROTECTS NOTHING ON READ. `lead_activity.lead_id`
-- references `lead`, which is under FORCE RLS — but that constraint governs what may be
-- *inserted*, not who may *select*. `SELECT * FROM lead_activity` with no join reads every
-- organisation's rows. Reaching a child table directly is not exotic; it is what any "recent
-- activity" query does.
--
-- What is actually in these tables:
--   lead_activity          — follow-up notes and call outcomes. Reading a rival's is reading
--                            their sales pipeline.
--   listing_price_history  — every price change, including on DRAFT and PRIVATE listings. A
--                            competitor watching a rival's unpublished repricing is exactly the
--                            commercial intelligence the tenancy model exists to prevent.
--
-- Both delegate to the parent rather than restating its rules. A child that re-implements its
-- parent's visibility logic is a second place for the two to disagree.

-- --- lead_activity --------------------------------------------------------------------------
ALTER TABLE lead_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activity FORCE  ROW LEVEL SECURITY;

CREATE POLICY lead_activity_tenant_policy ON lead_activity
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM lead l
      WHERE l.id = lead_activity.lead_id
        AND (l.organization_id = current_org_id() OR is_platform_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM lead l
      WHERE l.id = lead_activity.lead_id
        AND (l.organization_id = current_org_id() OR is_platform_admin())
    )
  );

-- --- listing_price_history ------------------------------------------------------------------
-- ⚠️ READ DELEGATES TO `can_view_listing`, NOT to ownership.
--
-- "Reduced by ₹5L last week" is a genuine buyer signal and belongs on a public listing page, so
-- the history of a PUBLIC + ACTIVE listing must be readable anonymously — exactly the set
-- `can_view_listing` already computes. Restricting reads to the owning org would make the feature
-- unimplementable; opening them entirely would publish draft repricing. The parent's own function
-- draws the line in precisely the right place.
ALTER TABLE listing_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_price_history FORCE  ROW LEVEL SECURITY;

CREATE POLICY listing_price_history_read_policy ON listing_price_history
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM listing l
      WHERE l.id = listing_price_history.listing_id
        AND can_view_listing(l.organization_id, l.visibility, l.status)
    )
  );

-- Writes are your own inventory only, whatever read tier a partner holds.
CREATE POLICY listing_price_history_write_policy ON listing_price_history
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM listing l
      WHERE l.id = listing_price_history.listing_id
        AND (l.organization_id = current_org_id() OR is_platform_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM listing l
      WHERE l.id = listing_price_history.listing_id
        AND (l.organization_id = current_org_id() OR is_platform_admin())
    )
  );

-- --- Deliberately NOT covered here -----------------------------------------------------------
--
-- `saved_search` is consumer-owned (keyed on contact_id, not organization_id), so an org-scoped
-- policy would be the wrong shape entirely — it needs a contact-session policy, and nothing reads
-- or writes it yet. Left alone rather than guessing at a model before the feature exists.
--
-- `refresh_token`, `otp_challenge` and `contact_identity` are reached ONLY through the
-- SECURITY DEFINER functions in 0011 and the auth services, which run before any tenant context
-- exists — that is the whole point of the keyhole. Putting them under RLS would break login
-- rather than secure it.
