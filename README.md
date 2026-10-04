# Dostlar Auto — B2B

B2B ordering platform for car accessories in Azerbaijan (prices in AZN).
Built with Next.js (App Router), TypeScript, Supabase (Postgres, Auth,
Storage) and deployed on Vercel.

## Features

- **Customers:** catalog with category filter and search, product gallery and
  videos, price for the customer's own price group (NORMAL / DEALER / VIP),
  cart, order placement, order history.
- **Owner (admin):** dashboard, orders (confirm / cancel with stock return),
  products (content, SKU, category, stock, three prices, active state,
  images with primary image, videos), categories, customers (create, edit,
  price group, active, archive, safe permanent delete).

## Security model

- All reads and writes of business data go through `SECURITY DEFINER` RPCs
  with `search_path = ''`, `EXECUTE` revoked from `anon`/`public`.
- Admin RPCs check for an active `OWNER` staff profile in the database.
- Prices are selected in the database from the customer's stored price group;
  the client never sends a price or a group. Order totals are computed in
  `create_order_from_cart`.
- Tables have RLS enabled and no direct grants except `SELECT` on the caller's
  own profile row.
- The Supabase secret key is only used server-side (`src/lib/supabase/admin.ts`,
  `server-only`) for customer login account management, after an OWNER check.

## Local development

```bash
cp .env.example .env.local   # fill in real values
npm install
npm run dev
```

## Database migrations

Migrations live in `supabase/migrations`. Never edit an applied migration;
add a new one instead.

```bash
npx supabase link --project-ref <project-ref>
npx supabase migration list --linked
npx supabase db push --linked
npx supabase gen types typescript --linked --schema public > src/types/database.types.ts
```

## Deploying to Vercel

1. Import the GitHub repository in Vercel (framework: Next.js, default build
   command `next build`).
2. Set environment variables for Production (and Preview if used):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY` (mark it as sensitive).
3. In Supabase → Authentication → URL Configuration set the Site URL to the
   Vercel production URL.
4. Apply pending migrations with `npx supabase db push --linked` before or
   together with the deploy.

## Checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```
