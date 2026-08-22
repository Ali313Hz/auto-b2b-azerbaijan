create type public.order_status as enum (
  'PENDING',
  'CONFIRMED',
  'CANCELLED'
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null
    references public.customer_profiles(id) on delete restrict,
  status public.order_status not null default 'PENDING',
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null
    references public.orders(id) on delete cascade,
  product_id uuid not null
    references public.products(id) on delete restrict,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index orders_customer_id_created_at_idx
on public.orders (customer_id, created_at desc);

create index order_items_order_id_idx
on public.order_items (order_id);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_items from anon, authenticated;