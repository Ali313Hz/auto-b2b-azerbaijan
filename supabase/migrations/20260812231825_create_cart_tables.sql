create table public.carts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique
    references public.customer_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null
    references public.carts(id) on delete cascade,
  product_id uuid not null
    references public.products(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (cart_id, product_id)
);

alter table public.carts enable row level security;
alter table public.cart_items enable row level security;

revoke all on table public.carts from anon, authenticated;
revoke all on table public.cart_items from anon, authenticated;