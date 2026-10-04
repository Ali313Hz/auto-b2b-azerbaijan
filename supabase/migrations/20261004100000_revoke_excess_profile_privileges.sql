-- Profile tables only need SELECT for authenticated users (RLS limits rows
-- to the caller's own profile). TRUNCATE is not subject to RLS, so remove
-- every privilege that was left over from default grants.

revoke all
on table public.customer_profiles
from anon, authenticated;

revoke all
on table public.staff_profiles
from anon, authenticated;

grant select
on table public.customer_profiles
to authenticated;

grant select
on table public.staff_profiles
to authenticated;
