create table public.product_media (
  id uuid primary key default gen_random_uuid(),

  product_id uuid not null
    references public.products(id)
    on delete cascade,

  media_type text not null
    check (media_type in ('IMAGE', 'VIDEO')),

  storage_path text not null unique,

  original_name text,

  mime_type text not null,

  sort_order integer not null default 0
    check (sort_order >= 0),

  is_primary boolean not null default false,

  created_at timestamptz not null default now()
);

create index product_media_product_id_idx
on public.product_media(product_id);

create unique index product_media_one_primary_image_idx
on public.product_media(product_id)
where media_type = 'IMAGE'
  and is_primary = true;


alter table public.product_media
enable row level security;

revoke all
on table public.product_media
from anon, authenticated;


insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-media',
  'product-media',
  false,
  52428800,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm'
  ]
)
on conflict (id)
do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


create policy "Authenticated users can read product media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'product-media'
);


create policy "Owners can upload product media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-media'
  and exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  )
);


create policy "Owners can update product media"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-media'
  and exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  )
)
with check (
  bucket_id = 'product-media'
  and exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  )
);


create policy "Owners can delete product media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-media'
  and exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = 'OWNER'
  )
);