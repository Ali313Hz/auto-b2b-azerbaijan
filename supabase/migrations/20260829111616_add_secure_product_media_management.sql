create or replace function public.get_admin_product_media(
  p_product_id uuid
)
returns table (
  id uuid,
  product_id uuid,
  media_type text,
  storage_path text,
  original_name text,
  mime_type text,
  sort_order integer,
  is_primary boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
    raise exception 'Not authorized to view product media';
  end if;

  return query
  select
    pm.id,
    pm.product_id,
    pm.media_type,
    pm.storage_path,
    pm.original_name,
    pm.mime_type,
    pm.sort_order,
    pm.is_primary,
    pm.created_at
  from public.product_media as pm
  where pm.product_id = p_product_id
  order by
    pm.media_type,
    pm.is_primary desc,
    pm.sort_order,
    pm.created_at,
    pm.id;
end;
$$;


create or replace function public.create_admin_product_media(
  p_product_id uuid,
  p_media_type text,
  p_storage_path text,
  p_original_name text,
  p_mime_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media_id uuid;
  v_media_type text;
  v_storage_path text;
  v_original_name text;
  v_mime_type text;
  v_is_primary boolean := false;
begin
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
    raise exception 'Not authorized to create product media';
  end if;

  if not exists (
    select 1
    from public.products as p
    where p.id = p_product_id
  ) then
    raise exception 'Product not found';
  end if;

  v_media_type := upper(nullif(trim(p_media_type), ''));
  v_storage_path := nullif(trim(p_storage_path), '');
  v_original_name := nullif(trim(p_original_name), '');
  v_mime_type := lower(nullif(trim(p_mime_type), ''));

  if v_media_type is null
     or v_media_type not in ('IMAGE', 'VIDEO') then
    raise exception 'Invalid media type';
  end if;

  if v_storage_path is null then
    raise exception 'Storage path is required';
  end if;

  if left(
    v_storage_path,
    length(p_product_id::text) + 1
  ) <> p_product_id::text || '/' then
    raise exception 'Invalid storage path';
  end if;

  if v_mime_type is null then
    raise exception 'Mime type is required';
  end if;

  if v_media_type = 'IMAGE'
     and v_mime_type not in (
       'image/jpeg',
       'image/png',
       'image/webp'
     ) then
    raise exception 'Invalid image mime type';
  end if;

  if v_media_type = 'VIDEO'
     and v_mime_type not in (
       'video/mp4',
       'video/webm'
     ) then
    raise exception 'Invalid video mime type';
  end if;

  if v_media_type = 'IMAGE' then
    v_is_primary := not exists (
      select 1
      from public.product_media as pm
      where pm.product_id = p_product_id
        and pm.media_type = 'IMAGE'
    );
  end if;

  insert into public.product_media (
    product_id,
    media_type,
    storage_path,
    original_name,
    mime_type,
    is_primary
  )
  values (
    p_product_id,
    v_media_type,
    v_storage_path,
    v_original_name,
    v_mime_type,
    v_is_primary
  )
  returning id into v_media_id;

  return v_media_id;
end;
$$;


create or replace function public.set_admin_product_primary_media(
  p_media_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_media_type text;
begin
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
    raise exception 'Not authorized to update product media';
  end if;

  select
    pm.product_id,
    pm.media_type
  into
    v_product_id,
    v_media_type
  from public.product_media as pm
  where pm.id = p_media_id;

  if not found then
    raise exception 'Product media not found';
  end if;

  if v_media_type <> 'IMAGE' then
    raise exception 'Only images can be primary';
  end if;

  update public.product_media
  set is_primary = false
  where product_id = v_product_id
    and media_type = 'IMAGE'
    and is_primary = true;

  update public.product_media
  set is_primary = true
  where id = p_media_id;
end;
$$;


create or replace function public.delete_admin_product_media(
  p_media_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_media_type text;
  v_storage_path text;
  v_was_primary boolean;
begin
  if not exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  ) then
    raise exception 'Not authorized to delete product media';
  end if;

  select
    pm.product_id,
    pm.media_type,
    pm.storage_path,
    pm.is_primary
  into
    v_product_id,
    v_media_type,
    v_storage_path,
    v_was_primary
  from public.product_media as pm
  where pm.id = p_media_id;

  if not found then
    raise exception 'Product media not found';
  end if;

  delete from public.product_media
  where id = p_media_id;

  if v_media_type = 'IMAGE'
     and v_was_primary = true then

    update public.product_media
    set is_primary = true
    where id = (
      select pm.id
      from public.product_media as pm
      where pm.product_id = v_product_id
        and pm.media_type = 'IMAGE'
      order by
        pm.sort_order,
        pm.created_at,
        pm.id
      limit 1
    );

  end if;

  return v_storage_path;
end;
$$;


revoke execute
on function public.get_admin_product_media(uuid)
from public, anon;

grant execute
on function public.get_admin_product_media(uuid)
to authenticated;


revoke execute
on function public.create_admin_product_media(
  uuid,
  text,
  text,
  text,
  text
)
from public, anon;

grant execute
on function public.create_admin_product_media(
  uuid,
  text,
  text,
  text,
  text
)
to authenticated;


revoke execute
on function public.set_admin_product_primary_media(uuid)
from public, anon;

grant execute
on function public.set_admin_product_primary_media(uuid)
to authenticated;


revoke execute
on function public.delete_admin_product_media(uuid)
from public, anon;

grant execute
on function public.delete_admin_product_media(uuid)
to authenticated;