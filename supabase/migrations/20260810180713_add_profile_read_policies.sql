create policy "Customers can read own profile"
on public.customer_profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "Staff can read own profile"
on public.staff_profiles
for select
to authenticated
using ((select auth.uid()) = id);