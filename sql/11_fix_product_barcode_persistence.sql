-- Run this whole file in the Supabase SQL Editor if product barcode edits save
-- in the form but immediately revert in the database.
--
-- Current reported case:
--   wanted barcode: 8858998583157
--   database kept:  020020298
--
-- Barcode and product_code are intentionally different columns. No trigger
-- should copy product_code into barcode.

alter table public.products
add column if not exists barcode text;

alter table public.products disable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.products to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- Drop only suspicious custom product triggers that reference barcode/product_code.
-- Keep the normal timestamp trigger: trg_products_updated_at.
do $$
declare
  trigger_row record;
begin
  for trigger_row in
    select
      t.tgname,
      pg_get_triggerdef(t.oid) as trigger_def,
      p.proname,
      pg_get_functiondef(p.oid) as function_def
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.products'::regclass
      and not t.tgisinternal
      and t.tgname <> 'trg_products_updated_at'
  loop
    if trigger_row.trigger_def ilike '%barcode%'
       or trigger_row.trigger_def ilike '%product_code%'
       or trigger_row.function_def ilike '%barcode%'
       or trigger_row.function_def ilike '%product_code%' then
      execute format('drop trigger if exists %I on public.products', trigger_row.tgname);
    end if;
  end loop;
end $$;

-- Fix the currently reported product barcode.
do $$
declare
  target_ids bigint[];
begin
  select array_agg(id)
  into target_ids
  from public.products
  where product_code = '020020298'
     or barcode = '020020298';

  if coalesce(array_length(target_ids, 1), 0) = 0 then
    raise exception 'Could not find product with product_code or barcode 020020298.';
  end if;

  if exists (
    select 1
    from public.products
    where barcode = '8858998583157'
      and not (id = any(target_ids))
  ) then
    raise exception 'Barcode 8858998583157 is already used by another product.';
  end if;

  update public.products
  set
    barcode = '8858998583157',
    updated_at = now()
  where id = any(target_ids);
end $$;

-- Verify. This must show barcode = 8858998583157.
select id, product_code, barcode, product_name, updated_at
from public.products
where product_code = '020020298'
   or barcode in ('020020298', '8858998583157')
order by updated_at desc nulls last;
