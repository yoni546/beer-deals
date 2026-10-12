-- ---------------------------------------------------------------------------
-- Stands in for the parts of a Supabase project that the platform provides:
-- the auth schema, the storage schema, and the two roles that requests arrive
-- as. It exists so the real migrations can be run against a throwaway Postgres
-- and the security rules can actually be tested.
--
-- Docker is not available on this machine, so `supabase start` is not an
-- option. Tests run against PGlite — Postgres compiled to WebAssembly — which
-- means `npm test` needs no credentials and no network.
-- ---------------------------------------------------------------------------

create schema if not exists auth;
create schema if not exists storage;

-- The two roles PostgREST switches into. RLS is only enforced for non-superuser
-- roles, so the tests must SET ROLE into these to prove anything at all.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase hands every NEW table in `public` to the API roles, before any
-- migration says a word:
--
--   alter default privileges in schema public grant all on tables
--     to postgres, anon, authenticated, service_role;
--
-- it runs at project creation. A bare Postgres does not, so until this line
-- existed the tests believed "we never granted it" meant "nobody has it" —
-- true here, false on the real thing. Staging proved the difference: anon held
-- SELECT, INSERT, DELETE and TRUNCATE on `admin_actions`, the append-only audit
-- log, which no migration ever grants.
--
-- So the tests now start from the platform's defaults, and a migration that
-- means a table to be unreachable has to REVOKE rather than stay silent.
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase reads the signed JWT claims out of a GUC. The tests set that GUC
-- directly, which is exactly what the real thing does after verifying the
-- token.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text,
  owner      uuid
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;
