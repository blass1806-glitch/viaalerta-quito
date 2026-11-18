
-- VíaAlerta Quito — geocerca territorial
-- Requiere cargar el polígono oficial antes de habilitar publicaciones.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.territory_boundaries (
  boundary_key text primary key,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  source_name text not null,
  source_url text,
  imported_at timestamptz not null default now(),
  constraint territory_boundary_valid check (extensions.ST_IsValid(geom))
);

alter table public.territory_boundaries enable row level security;
revoke all on table public.territory_boundaries from public, anon, authenticated;

create or replace function public.is_point_in_quito(p_lat double precision, p_lng double precision)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  boundary extensions.geometry(MultiPolygon, 4326);
begin
  if p_lat is null or p_lng is null
     or not (p_lat between -90 and 90)
     or not (p_lng between -180 and 180) then
    return false;
  end if;

  select geom into boundary
  from public.territory_boundaries
  where boundary_key = 'distrito_metropolitano_quito'
  limit 1;

  if boundary is null then
    return false;
  end if;

  return extensions.ST_Covers(
    boundary,
    extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326)
  );
end;
$$;

revoke all on function public.is_point_in_quito(double precision, double precision) from public, anon, authenticated;
grant execute on function public.is_point_in_quito(double precision, double precision) to service_role;
