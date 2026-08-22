create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products
add column category_id uuid
references public.categories(id)
on delete set null;

create index products_category_id_idx
on public.products(category_id);

alter table public.categories enable row level security;

revoke all on table public.categories from anon, authenticated;