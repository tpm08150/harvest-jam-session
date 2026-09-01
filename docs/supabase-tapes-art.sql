-- Harvest Jam Session — let sleeve art into the bucket
--
-- Run this if you set the project up BEFORE album artwork existed. It is a one-liner: the
-- bucket was created accepting only audio and the JSON sidecars, so a JPEG cover is
-- refused at upload with a mime-type error and the art never leaves the machine it was
-- added on. Everything else about the bucket and its policies stays as it is.
--
-- Nothing to run if you created the bucket from the current docs/supabase-tapes.sql, which
-- already lists all three types.

update storage.buckets
   set allowed_mime_types = array['audio/ogg', 'application/json', 'image/jpeg']
 where id = 'tapes';

-- Check it took:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'tapes';
