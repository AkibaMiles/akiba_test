export const URBAN_FEE = 3.0;
export const RURAL_FEE = 5.0;
export const MAX_FREE_ITEM_VALUE_CUSD = 15.0;

const URBAN_CITIES = new Set(["Nairobi", "Mombasa"]);

type VoucherPricingInput = {
  voucher_type?: string | null;
  discount_percent?: number | null;
  discount_cusd?: number | null;
};

export function getDeliveryFee(city: string): number {
  return URBAN_CITIES.has(city) ? URBAN_FEE : RURAL_FEE;
}

export function formatCityLabel(city: string): string {
  return city === "Other" ? "Other / Rural area" : city;
}

export function calcProductCost(price: number, voucher: VoucherPricingInput | null): number {
  if (!voucher) return price;
  if (voucher.voucher_type === "free") return 0;
  if (voucher.voucher_type === "percent_off" && voucher.discount_percent) {
    return price * (1 - voucher.discount_percent / 100);
  }
  if (voucher.voucher_type === "fixed_off" && voucher.discount_cusd) {
    return Math.max(0, price - voucher.discount_cusd);
  }
  return price;
}

export function isFreeVoucherEligibleForPrice(
  price: number,
  voucherType?: string | null,
): boolean {
  return voucherType !== "free" || price <= MAX_FREE_ITEM_VALUE_CUSD;
}
