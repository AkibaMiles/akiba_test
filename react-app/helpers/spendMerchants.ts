export type SpendMerchant = {
  id: string;
  slug: string;
  name: string;
  country: string;
  image_key?: string | null;
  image_url?: string | null;
  vouchers_available: number;
};

export type SpendVoucherTemplate = {
  id: string;
  merchant_id: string;
  title: string;
  description?: string | null;
  miles_cost: number;
  active: boolean;
  expires_at: string | null;
  cooldown_seconds?: number | null;
  global_cap?: number | null;
  rules?: string[] | null;
};

export type SpendMerchantDetail = SpendMerchant & {
  vouchers: SpendVoucherTemplate[];
};

export type IssuedVoucher = {
  voucher_code: string;
  qr_payload: string;
  expires_at: string;
  rules_snapshot: string[];
  burn_tx_hash?: string;
};

export async function fetchSpendMerchants(): Promise<SpendMerchant[]> {
  const res = await fetch("/api/Spend/merchants", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load merchants");
  const json = await res.json();
  return (json?.merchants ?? []) as SpendMerchant[];
}

export async function fetchSpendMerchantDetail(
  slug: string
): Promise<SpendMerchantDetail> {
  const res = await fetch(`/api/Spend/merchants/${slug}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load merchant details");
  const json = await res.json();
  return json?.merchant as SpendMerchantDetail;
}

export async function issueSpendVoucher(input: {
  merchant_id: string;
  voucher_template_id: string;
  user_address?: string;
  proof?: {
    address: `0x${string}`;
    timestamp: number;
    nonce: string;
    signature: `0x${string}`;
  };
  idempotency_key?: string;
}): Promise<IssuedVoucher> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (input.user_address) {
    headers["x-user-address"] = input.user_address;
  }
  if (input.idempotency_key) {
    headers["x-idempotency-key"] = input.idempotency_key;
  }

  const res = await fetch("/api/Spend/vouchers/issue", {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify({
      merchant_id: input.merchant_id,
      voucher_template_id: input.voucher_template_id,
      user_address: input.user_address,
      proof: input.proof,
      idempotency_key: input.idempotency_key,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error ?? "Failed to generate voucher");
  }

  return json as IssuedVoucher;
}
