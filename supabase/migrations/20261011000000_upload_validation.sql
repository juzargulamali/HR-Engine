-- No bucket had file_size_limit/allowed_mime_types set — the client-side
-- <input accept="..."> was the only type restriction anywhere, trivially
-- bypassed (devtools, or posting the FormData directly to the server
-- action), and there was no upper size bound at all. Belt-and-braces:
-- Supabase Storage itself now rejects anything outside these limits,
-- in addition to the application-level validation added in
-- apps/web/src/lib/uploads.ts (which the corresponding Server Actions now
-- call before ever reaching storage).
update storage.buckets
set file_size_limit = 10485760, -- 10 MiB
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
where id in ('employee-documents', 'identity-documents', 'receipts');

-- letters is populated only by issueLetter() itself (react-pdf output),
-- never by a user-supplied file — still worth a matching size ceiling and
-- an exact-type lock as defense in depth.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf']
where id = 'letters';
