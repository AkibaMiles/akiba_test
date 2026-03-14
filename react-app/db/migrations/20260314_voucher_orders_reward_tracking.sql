alter table public.voucher_orders
  add column if not exists miles_rewarded boolean not null default false,
  add column if not exists miles_reward_status text not null default 'pending',
  add column if not exists miles_reward_attempts integer not null default 0,
  add column if not exists miles_reward_tx_hash text,
  add column if not exists miles_reward_error text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'voucher_orders'
      and column_name = 'miles_rewarded'
  ) then
    update public.voucher_orders
    set
      miles_reward_status = case
        when miles_rewarded = true then 'completed'
        else 'pending'
      end,
      miles_reward_attempts = coalesce(miles_reward_attempts, 0)
    where miles_reward_status is null
       or miles_reward_attempts is null;
  else
    update public.voucher_orders
    set
      miles_reward_status = coalesce(miles_reward_status, 'pending'),
      miles_reward_attempts = coalesce(miles_reward_attempts, 0)
    where miles_reward_status is null
       or miles_reward_attempts is null;
  end if;
end $$;
