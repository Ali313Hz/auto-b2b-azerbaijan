create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_prices (
  product_id uuid primary key references public.products(id) on delete cascade,
  normal_price numeric(12, 2) not null check (normal_price >= 0),
  dealer_price numeric(12, 2) not null check (dealer_price >= 0),
  vip_price numeric(12, 2) not null check (vip_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;
alter table public.product_prices enable row level security;