-- Harvest Jam Session — cloud tape shelf
--
-- Run this in the NEW Supabase project's SQL editor (Dashboard → SQL Editor → New query).
-- It is deliberately a separate project from inventory-app: sharing one would put every
-- jam listener into the same auth.users table as the ~55 staff, share a single magic-link
-- email template between a business tool and a toy, and let a filled tape shelf eat the
-- storage quota that inventory-app's item photos depend on.
--
-- ⚠️ YOU DO NOT NEED TO ENABLE RLS. `storage.objects` ships with row-level security
--    already on, which is why there is no `alter table ... enable row level security`
--    below — only policies. RLS on with no policies denies everything, so a fresh bucket
--    is unreachable until the four rules below exist. (Contrast your own tables in
--    `public`, where RLS is OFF by default and you MUST enable it; inventory-app's
--    20260825000005_rls.sql does exactly that for `person`, `stock_level` and the rest.)
--
-- 🔴 THESE POLICIES ARE THE ONLY LOCK. The publishable key ships inside the deployed HTML
--    and anyone can read it out of the page source. It is not a secret and is not meant to
--    be one — the policies below are the entire thing standing between that key and every
--    user's tapes. Get them wrong and the bucket is public in practice.
--
-- ⚠️ `storage.objects` is owned by `supabase_storage_admin`, not by you. If the SQL editor
--    refuses these for privilege, add the same four rules by hand at Storage → Policies.
--    (inventory-app's item_photos migration carries the same warning.)

-- The bucket, made here rather than clicked, so the size cap and the accepted types are
-- written down. `public => false`: a public bucket serves objects by URL to anyone who ever
-- saw one, and the policies below would be decoration.
--
-- ⚠️ ALL THREE mime types are needed. The audio is Ogg Opus; the little sidecar carrying a
--    take's name and date is JSON; sleeve art is JPEG. A bucket that omits one of them
--    silently rejects those uploads — leaving, say, tapes in the cloud the shelf cannot
--    name, or covers that vanish on any machine but the one they were added on.
-- 32 MB is generous: the reel caps at five minutes, which is about 4.7 MB of Opus.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tapes', 'tapes', false, 33554432,
        array['audio/ogg', 'application/json', 'image/jpeg'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Each person's takes live under a folder named with their own auth uid, and the policies
-- below are what actually enforce that. The browser sends a publishable key that is public
-- by design; without these four rules it could read and write anybody's folder.
--
-- storage.foldername(name) splits the object path, so [1] is the first segment — the uid.

create policy "jam: read own tapes"
  on storage.objects for select to authenticated
  using (bucket_id = 'tapes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "jam: upload own tapes"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'tapes' and (storage.foldername(name))[1] = auth.uid()::text);

-- Needed as well as insert: the app re-PUTs a tape's sidecar JSON when you rename it, and
-- an upsert is an update once the object already exists.
create policy "jam: replace own tapes"
  on storage.objects for update to authenticated
  using      (bucket_id = 'tapes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'tapes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "jam: delete own tapes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'tapes' and (storage.foldername(name))[1] = auth.uid()::text);

-- Then: Authentication → Providers → Email → enable, with magic link / email OTP on.
-- Authentication → URL Configuration → Redirect URLs, add both:
--     http://localhost:5179
--     https://harvest-jam.netlify.app
-- A redirect URL that is not on that list makes the emailed link bounce to the site root
-- with no tokens on it, which looks exactly like "the link did nothing".
--
-- Finally paste the project URL and the publishable (anon) key into URL_BASE and KEY at the
-- top of src/shell/cloud.js. Never the service_role key — it bypasses every policy above.
