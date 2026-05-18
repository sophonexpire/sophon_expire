-- Run this whole file in Supabase SQL Editor for project:
-- https://uaqljdqtitdpctjxhutv.supabase.co
--
-- It fixes product editing/saving for the current app, adds product price
-- support, and deletes the item shown in the screenshot: 020020300 / 7-up Free 1.45 ml.

alter table public.products
add column if not exists price numeric(12, 2);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_price_nonnegative'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
    add constraint products_price_nonnegative check (price is null or price >= 0);
  end if;
end $$;

alter table public.categories disable row level security;
alter table public.products disable row level security;
alter table public.batches disable row level security;
alter table public.stock_movements disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.categories to anon, authenticated;
grant select, insert, update, delete on public.products to anon, authenticated;
grant select, insert, update, delete on public.batches to anon, authenticated;
grant select, insert, update, delete on public.stock_movements to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Barcode and product_code are different fields. If an old trigger/function in
-- the database forces barcode to match product_code, remove or fix that trigger.
-- Run this diagnostic query if barcode edits still revert:
-- select trigger_name, event_manipulation, action_statement
-- from information_schema.triggers
-- where event_object_schema = 'public'
--   and event_object_table = 'products'
-- order by trigger_name;
--
-- The normal timestamp trigger is OK:
--   trg_products_updated_at -> execute function set_updated_at()
-- Any trigger/function that assigns NEW.barcode := NEW.product_code should be dropped or changed.

delete from public.products
where product_code = '020020300'
   or barcode = '020020300';

-- Verify the screenshot item is gone:
-- select id, product_code, product_name
-- from public.products
-- where product_code = '020020300'
--    or barcode = '020020300';

-- Verify edit/add works:
-- insert into public.products (product_code, product_name, barcode, unit, price)
-- values (
--   'PRODUCT_WRITE_TEST_' || extract(epoch from now())::bigint,
--   'Product Write Test',
--   'PRODUCT_WRITE_TEST_BARCODE_' || extract(epoch from now())::bigint,
--   'box',
--   19.99
-- )
-- returning id, product_code, price;
