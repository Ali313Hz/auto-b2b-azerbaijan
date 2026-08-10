create table public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.staff_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_name text,
  contact_name text,
  phone text,
  price_group public.customer_price_group not null default 'NORMAL',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_profiles enable row level security;
alter table public.customer_profiles enable row level security;