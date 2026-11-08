// Local Postgres 17 harness that mimics the parts of Supabase the
// migrations depend on (roles, auth.uid()/jwt(), storage schema).
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../migrations");
const DATA_DIR = path.resolve(import.meta.dirname, ".pgdata");
export const PORT = 54329;

export async function startServer({ fresh = false } = {}) {
  if (fresh && fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "shared_buffers=256MB", "-c", "max_connections=120"],
  });
  if (!fs.existsSync(DATA_DIR)) {
    await server.initialise();
  }
  await server.start();
  return server;
}

export function client(database = "postgres") {
  return new pg.Client({
    host: "localhost",
    port: PORT,
    user: "postgres",
    password: "postgres",
    database,
  });
}

export function pool(database, max = 20) {
  return new pg.Pool({
    host: "localhost",
    port: PORT,
    user: "postgres",
    password: "postgres",
    database,
    max,
  });
}

export const SUPABASE_STUB = `
create extension if not exists pgcrypto;
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticator login noinherit; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz default now(),
  last_sign_in_at timestamptz
);
create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  aal text
);
create index if not exists sessions_user_id_idx on auth.sessions (user_id);
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  factor_type text not null default 'totp',
  status text not null default 'unverified'
);
create index if not exists mfa_factors_user_id_idx on auth.mfa_factors (user_id);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub', '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select auth.jwt()->>'role'
$$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb
);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
create or replace function storage.extension(name text) returns text language sql immutable as $$
  select lower(substring(name from '\\.([^.]+)$'))
$$;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
`;

export function migrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function createDatabase(name, { upTo } = {}) {
  const admin = client();
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name} template template0 encoding 'UTF8' locale 'C'`);
  await admin.end();

  const c = client(name);
  await c.connect();
  await c.query(SUPABASE_STUB);
  const applied = [];
  for (const file of migrationFiles()) {
    if (upTo && file > upTo) break;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await c.query("begin");
      await c.query(sql);
      await c.query("commit");
      applied.push(file);
    } catch (error) {
      await c.query("rollback");
      throw new Error(`Migration ${file} failed: ${error.message}`);
    }
  }
  return { c, applied };
}

// Runs fn as an API user: role switch + JWT claims, like PostgREST does.
export async function asUser(c, { sub, aal = "aal2", role = "authenticated" }, fn) {
  await c.query("begin");
  try {
    const claims = JSON.stringify(sub ? { sub, role, aal } : { role });
    await c.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    await c.query(`set local role ${role}`);
    const result = await fn();
    await c.query("rollback");
    return result;
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
}
