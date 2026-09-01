-- Harvest Jam Session — who is allowed in
--
-- Run this AFTER docs/supabase-tapes.sql and docs/supabase-tapes-shared.sql.
--
-- 🔴 WHY THIS EXISTS. Signing in with Google is NOT access control. Anyone on earth with a
--    Gmail account can complete that flow — it proves who someone is, not that they should
--    be here. The jam link is public, so without the rule below "signed in" still means
--    "anyone at all", and the shared shelf is readable by them.
--
-- ⚠️ THE ALLOWLIST IS THE WHOLE GATE — no domain shortcut. That matches the Hub, which is
--    also keyed on email rather than domain, and for the same reason its code gives: people
--    are still moving from personal addresses to @harvestkc.com / @hmxlive.com, so a domain
--    rule would silently lock out whoever has not moved yet AND silently let in anybody who
--    ever gets a company address. An explicit list says exactly who is in.
--
-- 🔴 THIS LIST IS A COPY, AND COPIES DRIFT. The Hub's allowlist lives in Firestore; Supabase
--    cannot read it, so this table is a mirror maintained by hand. Adding somebody to the
--    Hub does NOT let them into the jam. Whoever adds a person to one has to add them to
--    the other, and that is a real ongoing cost — it is the price of the two apps being on
--    two different backends.

-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 ADD YOURSELF IN THE SAME RUN. This file creates an EMPTY members table and then makes
--    every storage rule depend on it. Run it as-is and the first person locked out is you —
--    the app will sign you in happily and then say you are not on the list.
--
--    Edit the insert at the bottom of this file BEFORE running it, or paste this on its own
--    first:
--
--      insert into public.jam_members (email, note)
--      values ('you@your-domain.com', 'me')
--      on conflict (email) do nothing;
--
--    Lower-case: jam_allowed() lower-cases the address from the token before comparing.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.jam_members (
  email     text primary key,
  note      text,
  added_at  timestamptz not null default now()
);

-- ⚠️ RLS ON, AND NO POLICIES ON PURPOSE. Tables you create in `public` are exposed through
--    PostgREST and are world-readable until RLS is enabled — and a list of everyone's email
--    addresses is exactly the sort of thing not to publish. With RLS on and no policy, the
--    browser cannot read it at all; only the security-definer function below can.
alter table public.jam_members enable row level security;

create or replace function public.jam_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.jam_members m
     where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- If you ever DO want company addresses to get in without being listed, this is the line —
-- add it back with an `or`. Left out on purpose: see the note at the top.
--   lower(coalesce(auth.jwt() ->> 'email','')) ~ '@(harvestkc\.com|hmxlive\.com)$' or

-- The app asks this directly so it can say "your account is not on the Harvest list"
-- instead of showing an empty shelf that looks broken.
grant execute on function public.jam_allowed() to authenticated;

-- ---- re-cut the four storage rules to require membership ----
-- Same shapes as before; each one now also has to pass jam_allowed().
drop policy if exists "jam: read every tape"   on storage.objects;
drop policy if exists "jam: upload own tapes"  on storage.objects;
drop policy if exists "jam: replace own tapes" on storage.objects;
drop policy if exists "jam: delete own tapes"  on storage.objects;

create policy "jam: read every tape"
  on storage.objects for select to authenticated
  using (bucket_id = 'tapes' and public.jam_allowed());

create policy "jam: upload own tapes"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'tapes' and public.jam_allowed()
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "jam: replace own tapes"
  on storage.objects for update to authenticated
  using      (bucket_id = 'tapes' and public.jam_allowed()
              and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'tapes' and public.jam_allowed()
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "jam: delete own tapes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'tapes' and public.jam_allowed()
         and (storage.foldername(name))[1] = auth.uid()::text);

-- ---- the first entry ----
-- ⚠️ PUT YOUR OWN ADDRESS HERE BEFORE RUNNING THIS FILE. The policies above start requiring
--    membership the moment they exist, and this table starts empty — so whoever runs this
--    without editing the line below is the first person locked out.
--
--    Deliberately a placeholder rather than a real address: this repo is public, and a
--    committed email is a committed email forever.
insert into public.jam_members (email, note)
values ('you@your-domain.com', 'set up the jam')
on conflict (email) do nothing;

-- ---- adding everybody else ----
-- Lower-case, because that is what jam_allowed() compares against.
--   insert into public.jam_members (email, note) values
--     ('someone@harvestkc.com', 'FOH'),
--     ('someone.else@gmail.com', 'still on a personal address')
--   on conflict (email) do nothing;
--
-- ---- and removing them ----
--   delete from public.jam_members where email = 'someone@gmail.com';
--
-- Note this does NOT delete their takes; it only stops them reaching the bucket. Their
-- folder stays until you remove it in Storage.

-- ---- while you are here ----
-- Authentication → Providers → Google: enable it, paste the client ID and secret from the
-- Google Cloud OAuth client. Add both app addresses under URL Configuration → Redirect URLs:
--     http://localhost:5179
--     https://harvest-jam.netlify.app
-- Google itself needs the Supabase callback in its Authorized redirect URIs:
--     https://<project-ref>.supabase.co/auth/v1/callback
