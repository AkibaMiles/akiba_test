export type MerchantSeed = {
  id: string;
  slug: string;
  name: string;
  country: string;
  image_key: string;
};

export type VoucherTemplateSeed = {
  id: string;
  merchant_id: string;
  title: string;
  description: string;
  miles_cost: number;
  active: boolean;
  expires_at: string;
  cooldown_seconds: number;
  global_cap: number | null;
  rules: string[];
};

const now = Date.now();

export const FALLBACK_MERCHANTS: MerchantSeed[] = [
  {
    id: "m_oraimo",
    slug: "oraimo",
    name: "Oraimo",
    country: "Kenya",
    image_key: "oraimo",
  },
  {
    id: "m_amaya",
    slug: "amaya",
    name: "Amaya",
    country: "Kenya",
    image_key: "amaya",
  },
  {
    id: "m_vitron",
    slug: "vitron",
    name: "Vitron",
    country: "Kenya",
    image_key: "vitron",
  },
];

export const FALLBACK_VOUCHER_TEMPLATES: VoucherTemplateSeed[] = [
  {
    id: "vt_oraimo_500",
    merchant_id: "m_oraimo",
    title: "KES 500 Voucher",
    description: "Redeemable on Oraimo accessories.",
    miles_cost: 250,
    active: true,
    expires_at: new Date(now + 1000 * 60 * 60 * 24 * 60).toISOString(),
    cooldown_seconds: 60 * 60 * 24,
    global_cap: 2500,
    rules: ["One-time use", "Non-transferable", "Valid in Kenya"],
  },
  {
    id: "vt_oraimo_1000",
    merchant_id: "m_oraimo",
    title: "KES 1,000 Voucher",
    description: "Redeemable on Oraimo accessories.",
    miles_cost: 450,
    active: true,
    expires_at: new Date(now + 1000 * 60 * 60 * 24 * 60).toISOString(),
    cooldown_seconds: 60 * 60 * 24 * 2,
    global_cap: 1200,
    rules: ["One-time use", "Non-transferable", "Valid in Kenya"],
  },
  {
    id: "vt_amaya_300",
    merchant_id: "m_amaya",
    title: "KES 300 Voucher",
    description: "Redeem on selected Amaya products.",
    miles_cost: 180,
    active: true,
    expires_at: new Date(now + 1000 * 60 * 60 * 24 * 45).toISOString(),
    cooldown_seconds: 60 * 60 * 12,
    global_cap: 4000,
    rules: ["Single redemption", "Cannot be combined", "Valid in Kenya"],
  },
  {
    id: "vt_vitron_750",
    merchant_id: "m_vitron",
    title: "KES 750 Voucher",
    description: "Redeem on selected Vitron electronics.",
    miles_cost: 360,
    active: true,
    expires_at: new Date(now + 1000 * 60 * 60 * 24 * 30).toISOString(),
    cooldown_seconds: 60 * 60 * 24,
    global_cap: 1800,
    rules: ["Single redemption", "Non-refundable", "Valid in Kenya"],
  },
];
