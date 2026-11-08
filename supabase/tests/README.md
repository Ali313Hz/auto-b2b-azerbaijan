# Database tests

Run the migrations on a local, throw-away Postgres 17 (embedded-postgres)
with a small Supabase stub (roles, `auth.uid()`, sessions, storage), then
check permissions, sessions, passwords state, roles and order revisions.
No Supabase project, keys or network access are used.

```bash
cd supabase/tests
npm install
npm test
```

These packages are only for the tests; the app does not depend on them.
