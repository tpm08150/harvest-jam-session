-- Harvest Jam Session — turn the private shelf into a SHARED one
--
-- Run this AFTER docs/supabase-tapes.sql, in the same project's SQL editor.
--
-- What changes: reading. Until now a take was readable only by the person who made it.
-- After this, anyone SIGNED IN can listen to anyone's takes. Writing does not change —
-- you can still only put things in, rename, or delete inside your own folder.
--
-- 🔴 READ THIS BEFORE RUNNING IT. Signup on this project is currently OPEN: anybody on the
--    internet with an email address can create an account. The moment the policy below is
--    live, "signed in" and "anyone at all" are the same set of people, and every recording
--    in this bucket is effectively public to whoever bothers to sign up.
--
--    That may well be fine — they are jam takes, not payroll. But it should be a decision
--    rather than a surprise. Three ways to narrow it, in increasing effort:
--
--      a) Leave it open. Simplest. Assume anything uploaded is world-readable.
--      b) Turn signups off (Authentication → Providers → Email → "Allow new users to
--         sign up" OFF) once everyone who needs an account has one. New people then have
--         to be invited from the dashboard. Good fit for a fixed group of ~55.
--      c) An allowlist table plus a check in the policy, if the membership needs to keep
--         changing without dashboard work.
--
--    (b) is the one that matches Harvest: a known group, invited once.

-- Out with the private read...
drop policy if exists "jam: read own tapes" on storage.objects;

-- ...in with the shared one. Note this is SELECT only: insert, update and delete keep the
-- per-folder rules from the first file, so hearing someone's take never implies being able
-- to rename it, overwrite it, or delete it.
create policy "jam: read every tape"
  on storage.objects for select to authenticated
  using (bucket_id = 'tapes');

-- ⚠️ `to authenticated` is doing the real work here, and it is the ONLY thing standing
--    between this bucket and the open internet. Written `for select to public` — or with
--    the bucket flipped to Public — every take is downloadable with no account at all.
--    The bucket must stay private; this policy is what grants access, not the bucket flag.
