-- Enforce one order per on-chain payment transaction.
-- If this fails, inspect and resolve existing duplicates in voucher_orders first.
alter table public.voucher_orders
  add constraint voucher_orders_delivery_fee_tx_hash_key
  unique (delivery_fee_tx_hash);
