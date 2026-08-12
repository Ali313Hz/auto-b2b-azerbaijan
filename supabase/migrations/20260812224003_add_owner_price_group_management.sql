create table public.price_group_audit (
  id bigint generated always as identity primary key,
  customer_id uuid not null,
  changed_by uuid not null,
  old_price_group public.customer_price_group not null,
  new_price_group public.customer_price_group not null,
  changed_at timestamptz not null default now()
);

alter table public.price_group_audit enable row level security;

revoke all
on table public.price_group_audit
from public, anon, authenticated;


create or replace function public.set_customer_price_group(
  target_customer_id uuid,
  new_price_group public.customer_price_group
)
returns public.customer_price_group
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
  old_price_group public.customer_price_group;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.staff_profiles
    where id = current_user_id
      and role = 'OWNER'
      and active = true
  ) then
    raise exception 'Not authorized to change customer price group';
  end if;

  select price_group
  into old_price_group
  from public.customer_profiles
  where id = target_customer_id
  for update;

  if not found then
    raise exception 'Customer not found';
  end if;

  if old_price_group = new_price_group then
    return old_price_group;
  end if;

  update public.customer_profiles
  set
    price_group = new_price_group,
    updated_at = now()
  where id = target_customer_id;

  insert into public.price_group_audit (
    customer_id,
    changed_by,
    old_price_group,
    new_price_group
  )
  values (
    target_customer_id,
    current_user_id,
    old_price_group,
    new_price_group
  );

  return new_price_group;
end;
$$;

revoke execute
on function public.set_customer_price_group(
  uuid,
  public.customer_price_group
)
from public, anon;

grant execute
on function public.set_customer_price_group(
  uuid,
  public.customer_price_group
)
to authenticated;