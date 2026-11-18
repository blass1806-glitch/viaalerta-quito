-- VíaAlerta Quito — esquema endurecido (v2)
-- Ejecutar en Supabase SQL Editor con privilegios de propietario.
-- El navegador SOLO puede leer. Las escrituras pasan por Edge Functions.

create extension if not exists pgcrypto;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('pothole','manhole','blocked','flood')),
  description text not null default '' check (char_length(description) <= 500),
  lat double precision not null check (lat between -0.6 and 0.2),
  lng double precision not null check (lng between -79.2 and -78.0),
  photo_url text not null,
  status text not null default 'active' check (status in ('active','resolved')),
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  body text not null check (char_length(body) between 2 and 300),
  created_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists reports_category_created_idx on public.reports (category, created_at desc);
create index if not exists comments_report_created_idx on public.comments (report_id, created_at asc);

alter table public.reports enable row level security;
alter table public.comments enable row level security;

-- Eliminar políticas permisivas del esquema anterior y comenzar con privilegio mínimo.
drop policy if exists "Public can read reports" on public.reports;
drop policy if exists "Public can submit reports" on public.reports;
drop policy if exists "Public can read comments" on public.comments;
drop policy if exists "Public can submit comments" on public.comments;
drop policy if exists reports_public_read on public.reports;
drop policy if exists comments_public_read on public.comments;

revoke all on table public.reports from anon, authenticated;
revoke all on table public.comments from anon, authenticated;
grant select on table public.reports to anon, authenticated;
grant select on table public.comments to anon, authenticated;

create policy reports_public_read on public.reports
  for select to anon, authenticated using (true);
create policy comments_public_read on public.comments
  for select to anon, authenticated using (true);

-- No conceder INSERT, UPDATE, DELETE ni TRUNCATE a roles del navegador.
-- Las Edge Functions usan service_role exclusivamente en el servidor.

-- Rate limiting atómico: solo ejecutable por service_role.
create table if not exists public.rate_limit_buckets (
  key_hash text not null,
  action text not null,
  window_started_at timestamptz not null,
  hits integer not null check (hits >= 0),
  primary key (key_hash, action)
);
revoke all on table public.rate_limit_buckets from anon, authenticated;

create or replace function public.consume_rate_limit(
  p_key_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_hits integer;
begin
  if p_key_hash is null or length(p_key_hash) < 32
     or p_action not in ('report','comment')
     or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.rate_limit_buckets(key_hash, action, window_started_at, hits)
  values (p_key_hash, p_action, clock_timestamp(), 1)
  on conflict (key_hash, action) do update
    set window_started_at = case
          when public.rate_limit_buckets.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds)
          then clock_timestamp() else public.rate_limit_buckets.window_started_at end,
        hits = case
          when public.rate_limit_buckets.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds)
          then 1 else public.rate_limit_buckets.hits + 1 end
  returning hits into current_hits;

  return current_hits <= p_limit;
end;
$$;
revoke all on function public.consume_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text,text,integer,integer) to service_role;

-- Moderación básica adicional en la base de datos. La moderación principal ocurre en Edge Function.
create or replace function public.reject_basic_profanity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare content text;
begin
  if tg_table_name = 'comments' then content := lower(coalesce(new.body, ''));
  else content := lower(coalesce(new.description, '')); end if;
  content := translate(content, 'áéíóúü', 'aeiouu');
  if content ~ '(^|[^a-z0-9])(puta|puto|mierda|pendejo|pendeja|idiota|imbecil|hijueputa|malparido|malparida|maricon)([^a-z0-9]|$)' then
    raise exception 'El texto requiere revisión por lenguaje no permitido.';
  end if;
  return new;
end;
$$;

drop trigger if exists comments_profanity_guard on public.comments;
create trigger comments_profanity_guard before insert on public.comments
for each row execute function public.reject_basic_profanity();
drop trigger if exists reports_profanity_guard on public.reports;
create trigger reports_profanity_guard before insert on public.reports
for each row execute function public.reject_basic_profanity();

-- Bucket público de SOLO LECTURA. Las cargas las hace el servidor con service_role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Public can view report photos" on storage.objects;
drop policy if exists "Public can upload report photos" on storage.objects;
drop policy if exists report_photos_public_read on storage.objects;
drop policy if exists report_photos_public_upload on storage.objects;
create policy report_photos_public_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'report-photos');
-- No política INSERT/UPDATE/DELETE para anon/authenticated.

-- IMPORTANTE: el acceso público a fotografías significa que sus URL son públicas.
-- No almacenar metadatos privados ni incluir información personal en las imágenes.
