-- Yako Trading tracker: database setup
-- Paste this whole file into Supabase > SQL Editor > New query, then press "Run".
-- It is safe to run more than once.

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  supplier text,
  forwarder text,
  order_date date,
  arrival_date date,
  status text not null default 'Ordered',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  type text not null check (type in ('income', 'expense')),
  category text not null,
  description text,
  client text,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'GHS',
  rate numeric(14,6) not null default 1,
  amount_ghs numeric(14,2) not null,
  shipment_id uuid references public.shipments(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_date on public.transactions (user_id, date desc);
create index if not exists transactions_shipment on public.transactions (shipment_id);

-- Row Level Security: each signed-in account can only see and change its own records.
alter table public.shipments enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "own shipments" on public.shipments;
create policy "own shipments" on public.shipments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
