"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image, { type StaticImageData } from "next/image";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CaretLeft, CheckCircle } from "@phosphor-icons/react";
import { useWeb3 } from "@/contexts/useWeb3";
import FeedbackDialog from "./FeedbackDialog";
import MerchantVoucherSheet from "./merchant-voucher-sheet";
import { akibaMilesSymbol, akibaMilesSymbolAlt } from "@/lib/svg";
import {
  MAX_FREE_ITEM_VALUE_CUSD,
  RURAL_FEE,
  URBAN_FEE,
  calcProductCost,
  formatCityLabel,
  getDeliveryFee,
  isFreeVoucherEligibleForPrice,
} from "@/lib/spendOrderPricing";

const KENYA_ONLY = true;
// Display rate is set above market (128 KES/USD) to generate a small spread
const KES_DISPLAY_RATE = 130;

const CITY_OPTIONS: { group: string; fee: number; cities: string[] }[] = [
  {
    group: "Major Cities — $3.00 delivery",
    fee: URBAN_FEE,
    cities: ["Nairobi", "Mombasa"],
  },
  {
    group: "Other Towns — $5.00 delivery",
    fee: RURAL_FEE,
    cities: ["Kisumu", "Nakuru", "Eldoret", "Thika", "Nyeri", "Meru", "Kisii", "Malindi", "Kitale", "Garissa"],
  },
  {
    group: "Other / Rural — $5.00 delivery",
    fee: RURAL_FEE,
    cities: ["Other"],
  },
];
const EXPLORER_BASE = "https://celoscan.io/tx";
const CUSD_ADDRESS = "0x765de816845861e75a25fca122bb6898b8b1282a";
const USDT_ADDRESS = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const CUSD_DECIMALS = 18;
const USDT_DECIMALS = 6;

type Step = "products" | "voucher" | "delivery" | "payment" | "success";

type MerchantProduct = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price_cusd: number;
  category: string | null;
};

export type OrderVoucher = {
  id: string;
  merchant_id: string;
  merchant_name: string;
  voucher_title: string;
  status: string;
  voucher_type?: "free" | "percent_off" | "fixed_off" | string | null;
  discount_percent?: number | null;
  applicable_category?: string | null;
  discount_cusd?: number | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Pre-selected voucher path (from My Vouchers):
  voucher?: OrderVoucher | null;
  // Merchant-first path (from Shop):
  merchantId?: string | null;
  merchantName?: string | null;
  merchantSlug?: string | null;
  merchantImage?: StaticImageData | null;
};

function voucherLabel(v: OrderVoucher): string {
  if (v.voucher_type === "free") return "Free item";
  if (v.voucher_type === "percent_off" && v.discount_percent) return `${v.discount_percent}% off`;
  if (v.voucher_type === "fixed_off" && v.discount_cusd) return `-$${v.discount_cusd.toFixed(2)}`;
  return "Voucher";
}

export default function VoucherOrderSheet({
  open,
  onOpenChange,
  voucher,
  merchantId,
  merchantName,
  merchantSlug,
  merchantImage,
}: Props) {
  const { address, sendToken, getStableBalances } = useWeb3();

  const effectiveMerchantId = voucher?.merchant_id ?? merchantId ?? null;
  const effectiveMerchantName = voucher?.merchant_name ?? merchantName ?? "Merchant";

  const [step, setStep] = useState<Step>("products");
  const [products, setProducts] = useState<MerchantProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<MerchantProduct | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Vouchers for this merchant fetched from user wallet
  const [merchantVouchers, setMerchantVouchers] = useState<OrderVoucher[]>([]);
  const [selectedVoucher, setSelectedVoucher] = useState<OrderVoucher | null>(voucher ?? null);
  const [loadingVouchers, setLoadingVouchers] = useState(false);

  // Balances
  const [cusdBalance, setCusdBalance] = useState<number | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);
  const [selectedCurrency, setSelectedCurrency] = useState<"cUSD" | "USDT">("cUSD");

  const [recipientName, setRecipientName] = useState("");
  const [phone9, setPhone9] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [locationDetails, setLocationDetails] = useState("");

  const [processing, setProcessing] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [milesEarned, setMilesEarned] = useState<number | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const [errorModal, setErrorModal] = useState<{ title: string; desc?: string } | null>(null);
  const [merchantVoucherSheetOpen, setMerchantVoucherSheetOpen] = useState(false);

  const deliveryFee = getDeliveryFee(selectedCity);
  const deliveryFeeDisplay = `$${deliveryFee.toFixed(2)}`;
  const selectedCityLabel = formatCityLabel(selectedCity);

  // Reset and fetch products when sheet opens
  useEffect(() => {
    if (!open || !effectiveMerchantId) return;

    setStep("products");
    setSelectedProduct(null);
    setSelectedVoucher(voucher ?? null);
    setMerchantVouchers([]);
    setRecipientName("");
    setPhone9("");
    setSelectedCity("");
    setLocationDetails("");
    setOrderId(null);
    setMilesEarned(null);
    setTxHash(null);
    setCusdBalance(null);
    setUsdtBalance(null);
    setProducts([]);
    setCategoryFilter("all");

    let active = true;
    setLoadingProducts(true);

    fetch(`/api/Spend/orders/products?merchant_id=${effectiveMerchantId}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Failed to load products");
        if (active) setProducts(json?.products ?? []);
      })
      .catch((err: any) => {
        if (active) setErrorModal({ title: "Failed to load products", desc: err.message });
      })
      .finally(() => { if (active) setLoadingProducts(false); });

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effectiveMerchantId]);

  // When advancing from products step: fetch user's vouchers + balances in parallel
  const handleProductsNext = async () => {
    if (!selectedProduct) return;

    if (!address) {
      setErrorModal({ title: "Wallet required", desc: "Connect your wallet first." });
      return;
    }

    setLoadingVouchers(true);

    try {
      const [vouchersRes, balances] = await Promise.all([
        fetch(`/api/Spend/vouchers/user/${address}`, { cache: "no-store" }),
        getStableBalances(),
      ]);

      const vJson = await vouchersRes.json();
      const all: OrderVoucher[] = (vJson?.vouchers ?? []) as OrderVoucher[];
      const productCategory = selectedProduct?.category ?? null;
      const relevant = all.filter(
        (v) =>
          v.merchant_id === effectiveMerchantId &&
          v.status === "issued" &&
          (v.applicable_category == null || v.applicable_category === productCategory)
      );
      setMerchantVouchers(relevant);
      setCusdBalance(balances.cusd);
      setUsdtBalance(balances.usdt);

      // Auto-select currency based on balance (use max fee conservatively)
      const productCost = calcProductCost(selectedProduct.price_cusd, selectedVoucher);
      const total = productCost + RURAL_FEE;
      if (balances.cusd >= total) {
        setSelectedCurrency("cUSD");
      } else if (balances.usdt >= total) {
        setSelectedCurrency("USDT");
      } else {
        setSelectedCurrency("cUSD"); // will show "insufficient" at payment
      }

      if (voucher && !isFreeVoucherEligibleForPrice(selectedProduct.price_cusd, voucher.voucher_type)) {
        setSelectedVoucher(null);
        setErrorModal({
          title: "Voucher not eligible",
          desc: `Free-item vouchers can only be used on products up to $${MAX_FREE_ITEM_VALUE_CUSD.toFixed(2)}.`,
        });
        setStep("voucher");
        return;
      }

      // If a voucher was pre-selected (from My Vouchers path), skip voucher step
      if (voucher) {
        setSelectedVoucher(voucher);
        setStep("delivery");
      } else {
        setStep("voucher");
      }
    } catch (err: any) {
      setErrorModal({ title: "Failed to load details", desc: err.message });
    } finally {
      setLoadingVouchers(false);
    }
  };

  const totalCost = selectedProduct
    ? calcProductCost(selectedProduct.price_cusd, selectedVoucher) + deliveryFee
    : deliveryFee;

  const productCostDisplay = selectedProduct
    ? calcProductCost(selectedProduct.price_cusd, selectedVoucher)
    : 0;

  const hasEnoughBalance =
    selectedCurrency === "cUSD"
      ? (cusdBalance ?? 0) >= totalCost
      : (usdtBalance ?? 0) >= totalCost;

  const handlePayAndOrder = async () => {
    if (!address || !selectedProduct) return;
    if (!selectedCity.trim()) return;
    if (!isFreeVoucherEligibleForPrice(selectedProduct.price_cusd, selectedVoucher?.voucher_type)) {
      setErrorModal({
        title: "Voucher not eligible",
        desc: `Free-item vouchers can only be used on products up to $${MAX_FREE_ITEM_VALUE_CUSD.toFixed(2)}.`,
      });
      return;
    }

    const paymentAddress = process.env.NEXT_PUBLIC_DELIVERY_FEE_ADDRESS;
    if (!paymentAddress) {
      setErrorModal({ title: "Config error", desc: "Payment address not configured." });
      return;
    }

    if (!hasEnoughBalance) {
      setErrorModal({
        title: "Insufficient balance",
        desc: `You need $${totalCost.toFixed(2)} ${selectedCurrency} but your balance is insufficient.`,
      });
      return;
    }

    const tokenAddress = selectedCurrency === "cUSD" ? CUSD_ADDRESS : USDT_ADDRESS;
    const tokenDecimals = selectedCurrency === "cUSD" ? CUSD_DECIMALS : USDT_DECIMALS;

    // Determine payment_type
    const payment_type = !selectedVoucher
      ? "direct"
      : selectedVoucher.voucher_type === "free"
      ? "voucher_free"
      : "voucher_discount";

    try {
      setProcessing(true);

      const receipt = await sendToken(
        tokenAddress,
        tokenDecimals,
        paymentAddress,
        totalCost.toFixed(selectedCurrency === "cUSD" ? 18 : 6)
      );
      const hash = receipt.transactionHash as string;
      setTxHash(hash);

      const res = await fetch("/api/Spend/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: selectedProduct.id,
          voucher_id: selectedVoucher?.id ?? null,
          recipient_name: recipientName.trim(),
          phone: `+254${phone9}`,
          city: selectedCityLabel,
          location_details: locationDetails.trim() || null,
          delivery_fee_tx_hash: hash,
          user_address: address,
          payment_type,
          amount_paid_cusd: totalCost,
          currency: selectedCurrency,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Order creation failed");

      setOrderId(json.order_id);
      setMilesEarned(json.miles_earned ?? 200);
      setStep("success");
      window.dispatchEvent(new Event("akiba:miles:refresh"));
    } catch (err: any) {
      const rejected = /user rejected|cancelled/i.test(err?.message ?? "");
      if (rejected) {
        setErrorModal({ title: "Cancelled", desc: "You cancelled the payment." });
      } else {
        const msg = txHash
          ? `${err.message ?? "Order creation failed"}. Your payment TX: ${txHash}`
          : (err.message ?? "Something went wrong. Please try again.");
        setErrorModal({ title: "Order failed", desc: msg });
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="bg-white rounded-t-xl font-sterling max-h-[90vh] overflow-auto p-3"
        >
          {!KENYA_ONLY ? (
            <div className="flex flex-col items-center justify-center h-64">
              <p className="text-sm text-gray-500">Ordering is not available in your region.</p>
            </div>
          ) : loadingProducts || processing || loadingVouchers ? (
            <div className="flex flex-col items-center justify-center h-64">
              <p className="text-gray-500">
                {processing
                  ? "Processing payment…"
                  : loadingVouchers
                  ? "Loading details…"
                  : "Loading products…"}
              </p>
            </div>

          ) : step === "products" ? (
            /* ── STEP 1: Product selection ── */
            <div>
              <SheetHeader className="pt-4"><SheetTitle></SheetTitle></SheetHeader>
              <div className="flex flex-col items-start mb-4">
                <h3 className="text-sm font-medium bg-[#24E5E033] text-[#1E8C89] rounded-full px-3">
                  Shop
                </h3>
                <h2 className="text-black font-medium text-2xl my-2">{effectiveMerchantName}</h2>
              </div>

              <p className="text-base font-semibold mb-3">Select a product</p>

              {products.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  No products available yet.
                </p>
              ) : (
                <>
                  {/* Category filter chips */}
                  {(() => {
                    const cats = Array.from(new Set(products.map((p) => p.category).filter(Boolean)));
                    if (cats.length < 2) return null;
                    const labels: Record<string, string> = { device: "Devices", accessory: "Accessories", service: "Services" };
                    return (
                      <div className="flex gap-2 mb-4 overflow-x-auto pb-1 no-scrollbar">
                        <button
                          type="button"
                          onClick={() => setCategoryFilter("all")}
                          className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                            categoryFilter === "all"
                              ? "bg-[#238D9D] text-white"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          All
                        </button>
                        {cats.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setCategoryFilter(cat!)}
                            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                              categoryFilter === cat
                                ? "bg-[#238D9D] text-white"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {labels[cat!] ?? cat}
                          </button>
                        ))}
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {products.filter((p) => categoryFilter === "all" || p.category === categoryFilter).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedProduct(p)}
                        className={`rounded-xl border-2 p-3 text-left transition-colors ${
                          selectedProduct?.id === p.id
                            ? "border-[#238D9D] bg-[#238D9D0D]"
                            : "border-gray-200"
                        }`}
                      >
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt={p.name} className="w-full h-24 object-cover rounded-lg mb-2" />
                        ) : (
                          <div className="w-full h-24 bg-gray-100 rounded-lg mb-2 flex items-center justify-center text-gray-400 text-xs">No image</div>
                        )}
                        <p className="font-medium text-sm text-black leading-tight">{p.name}</p>
                        {p.description ? (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{p.description}</p>
                        ) : null}
                        <p className="text-xs font-semibold text-[#238D9D] mt-1">
                          ${Number(p.price_cusd).toFixed(2)}
                        </p>
                        <p className="text-xs text-gray-400">
                          KES {Math.round(Number(p.price_cusd) * KES_DISPLAY_RATE).toLocaleString()}
                        </p>
                      </button>
                    ))}
                  </div>

                  <Button
                    className="w-full rounded-xl bg-[#238D9D] text-white h-[56px] font-medium text-lg"
                    disabled={!selectedProduct}
                    onClick={handleProductsNext}
                    title="Next"
                  >
                    Next
                  </Button>
                </>
              )}
            </div>

          ) : step === "voucher" ? (
            /* ── STEP 2: Voucher selection ── */
            <div>
              <div className="flex items-center pt-4 mb-4">
                <CaretLeft size={24} className="cursor-pointer" onClick={() => setStep("products")} />
              </div>

              <p className="text-xl font-semibold mb-1">Apply a voucher?</p>
              <p className="text-sm text-gray-500 mb-4">
                Use a voucher for a discount, or pay the full price. Every purchase earns 200 AkibaMiles. Delivery charge is selected on the next page.
              </p>

              <div className="mb-4 flex items-center gap-3 rounded-xl bg-[#24E5E033] px-4 py-3 text-sm font-medium text-[#1E8C89]">
                <span>Earn</span>
                <Image src={akibaMilesSymbol} width={22} height={22} alt="" />
                <span>200 on this order</span>
              </div>

              <div className="space-y-3 mb-4">
                {/* No voucher option */}
                <button
                  type="button"
                  onClick={() => setSelectedVoucher(null)}
                  className={`w-full rounded-xl border-2 p-4 text-left transition-colors ${
                    selectedVoucher === null ? "border-[#238D9D] bg-[#238D9D0D]" : "border-gray-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-black">Pay full price</p>
                      <p className="text-sm text-gray-500">
                        ${Number(selectedProduct?.price_cusd ?? 0).toFixed(2)} + Delivery charge
                      </p>
                    </div>
                    {selectedVoucher === null && (
                      <CheckCircle size={22} weight="fill" color="#238D9D" />
                    )}
                  </div>
                </button>

                {merchantVouchers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#238D9D33] bg-[#238D9D08] px-4 py-4 text-center">
                    <p className="text-sm text-gray-600">
                      No {effectiveMerchantName} vouchers in your wallet.
                    </p>
                    {merchantSlug && merchantImage ? (
                      <button
                        type="button"
                        onClick={() => {
                          onOpenChange(false);
                          setMerchantVoucherSheetOpen(true);
                        }}
                        className="mt-3 text-sm font-medium text-[#238D9D]"
                      >
                        Get vouchers for {effectiveMerchantName}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  merchantVouchers.map((v) => {
                    const discountedCost = calcProductCost(selectedProduct?.price_cusd ?? 0, v);
                    const voucherEligible = isFreeVoucherEligibleForPrice(
                      selectedProduct?.price_cusd ?? 0,
                      v.voucher_type,
                    );
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          if (!voucherEligible) return;
                          setSelectedVoucher(v);
                        }}
                        disabled={!voucherEligible}
                        className={`w-full rounded-xl border-2 p-4 text-left transition-colors ${
                          selectedVoucher?.id === v.id
                            ? "border-[#238D9D] bg-[#238D9D0D]"
                            : "border-gray-200"
                        } ${!voucherEligible ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="font-medium text-black">{v.voucher_title}</p>
                              <span className="text-xs font-medium bg-[#238D9D1A] text-[#238D9D] rounded-full px-2 py-0.5">
                                {voucherLabel(v)}
                              </span>
                            </div>
                            <p className="text-sm text-gray-500">
                              ${discountedCost.toFixed(2)} + Delivery charge
                            </p>
                            {!voucherEligible ? (
                              <p className="text-xs text-amber-600 mt-1">
                                Free-item vouchers only apply to products up to ${MAX_FREE_ITEM_VALUE_CUSD.toFixed(2)}.
                              </p>
                            ) : null}
                          </div>
                          {selectedVoucher?.id === v.id && (
                            <CheckCircle size={22} weight="fill" color="#238D9D" />
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              <Button
                className="w-full rounded-xl bg-[#238D9D] text-white h-[56px] font-medium text-lg"
                onClick={() => setStep("delivery")}
                title="Continue"
              >
                Continue
              </Button>
            </div>

          ) : step === "delivery" ? (
            /* ── STEP 3: Delivery details ── */
            <div>
              <div className="flex items-center pt-4 mb-4">
                <CaretLeft
                  size={24}
                  className="cursor-pointer"
                  onClick={() => setStep(voucher ? "products" : "voucher")}
                />
              </div>

              <p className="text-xl font-semibold mb-1">Delivery details</p>
              <p className="text-sm text-gray-500 mb-4">Kenya delivery only. Major cities are $3, rural delivery is $5.</p>

              <div className="space-y-3 mb-6">
                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Recipient name</label>
                  <Input
                    placeholder="Full name"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="rounded-xl h-[48px]"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Phone number</label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-600 bg-gray-100 rounded-xl px-3 h-[48px] flex items-center">
                      +254
                    </span>
                    <Input
                      placeholder="712345678"
                      value={phone9}
                      onChange={(e) => setPhone9(e.target.value.replace(/\D/g, "").slice(0, 9))}
                      inputMode="numeric"
                      className="rounded-xl h-[48px] flex-1"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">Delivery city</label>
                  <select
                    value={selectedCity}
                    onChange={(e) => setSelectedCity(e.target.value)}
                    className="flex h-[48px] w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Select your city</option>
                    {CITY_OPTIONS.map((group) => (
                      <optgroup key={group.group} label={group.group}>
                        {group.cities.map((city) => (
                          <option key={city} value={city}>
                            {formatCityLabel(city)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl border border-[#238D9D1F] bg-[#238D9D0D] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-black">Delivery fee</p>
                      <p className="text-xs text-gray-500">
                        {selectedCity
                          ? `${selectedCityLabel} qualifies for ${deliveryFeeDisplay} delivery.`
                          : "Choose a city to see the delivery fee."}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-[#238D9D]">
                      {selectedCity ? deliveryFeeDisplay : "Pick city"}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700 block mb-1">
                    Location details
                  </label>
                  <textarea
                    placeholder="Estate, building, landmark, gate instructions, or anything that helps delivery."
                    value={locationDetails}
                    onChange={(e) => setLocationDetails(e.target.value)}
                    rows={4}
                    className="flex w-full rounded-xl border border-input bg-transparent px-3 py-3 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>

              <Button
                className="w-full rounded-xl bg-[#238D9D] text-white h-[56px] font-medium text-lg"
                disabled={!recipientName.trim() || phone9.length !== 9 || !selectedCity.trim()}
                onClick={() => setStep("payment")}
                title="Next"
              >
                Next
              </Button>
            </div>

          ) : step === "payment" ? (
            /* ── STEP 4: Payment ── */
            <div>
              <div className="flex items-center pt-4 mb-4">
                <CaretLeft size={24} className="cursor-pointer" onClick={() => setStep("delivery")} />
              </div>

              <p className="text-xl font-semibold mb-4">Order summary</p>

              <div className="rounded-xl border border-gray-200 p-4 space-y-3 mb-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Product</span>
                  <span className="font-medium text-right max-w-[60%]">{selectedProduct?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Product cost</span>
                  <span className="font-medium">
                    {productCostDisplay === 0
                      ? <span className="text-green-600">Free</span>
                      : `$${productCostDisplay.toFixed(2)}`}
                    {selectedVoucher && (
                      <span className="text-xs text-[#238D9D] ml-1">({voucherLabel(selectedVoucher)})</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Delivery</span>
                  <span className="font-medium">{deliveryFeeDisplay}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Recipient</span>
                  <span className="font-medium">{recipientName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Phone</span>
                  <span className="font-medium">+254{phone9}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">City</span>
                  <span className="font-medium">{selectedCityLabel}</span>
                </div>
                {locationDetails.trim() ? (
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Location notes</span>
                    <span className="font-medium text-right max-w-[60%]">{locationDetails.trim()}</span>
                  </div>
                ) : null}
                <div className="border-t border-gray-100 pt-3 flex justify-between items-baseline">
                  <span className="font-semibold">Total</span>
                  <div className="text-right">
                    <span className="font-semibold text-[#238D9D]">${totalCost.toFixed(2)}</span>
                    <span className="text-xs text-gray-400 block">
                      ≈ KES {Math.round(totalCost * KES_DISPLAY_RATE).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Currency selector */}
              <p className="text-sm font-medium text-gray-700 mb-2">Pay with</p>
              <div className="flex gap-2 mb-1">
                {(["cUSD", "USDT"] as const).map((cur) => {
                  const bal = cur === "cUSD" ? cusdBalance : usdtBalance;
                  const enough = (bal ?? 0) >= totalCost;
                  return (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => setSelectedCurrency(cur)}
                      className={`flex-1 rounded-xl border-2 py-3 text-sm font-medium transition-colors ${
                        selectedCurrency === cur
                          ? "border-[#238D9D] bg-[#238D9D0D] text-[#238D9D]"
                          : "border-gray-200 text-gray-600"
                      }`}
                    >
                      {cur}
                      <span className={`block text-xs mt-0.5 ${enough ? "text-gray-400" : "text-red-400"}`}>
                        bal: {bal !== null ? `$${bal.toFixed(2)}` : "…"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {!hasEnoughBalance && (
                <p className="text-xs text-red-500 mb-3">
                  Insufficient {selectedCurrency} balance for this order.
                </p>
              )}

              <p className="text-xs text-gray-400 mb-3 mt-2">
                You'll earn <span className="font-semibold text-[#238D9D]">200 AkibaMiles</span> on this purchase.
              </p>

              <Button
                className="w-full rounded-xl bg-[#238D9D] text-white h-[56px] font-medium text-lg mb-2"
                disabled={!hasEnoughBalance}
                onClick={handlePayAndOrder}
                title="Pay & Order"
              >
                Pay &amp; Order
              </Button>
              <p className="text-xs text-center text-gray-400">
                Payment is non-refundable once submitted.
              </p>
            </div>

          ) : (
            /* ── STEP 5: Success ── */
            <div className="flex flex-col items-center justify-center py-10 space-y-4">
              <div className="w-16 h-16 rounded-full bg-[#238D9D1A] flex items-center justify-center text-3xl">
                🎉
              </div>
              <h2 className="text-2xl font-semibold text-black">Order placed!</h2>
              {orderId ? (
                <p className="text-sm text-gray-500">Order #{orderId.slice(0, 8).toUpperCase()}</p>
              ) : null}
              {milesEarned ? (
                <div className="rounded-xl bg-[#24E5E033] text-[#1E8C89] px-4 py-2 text-sm font-medium">
                  +{milesEarned} AkibaMiles earned!
                </div>
              ) : null}
              <p className="text-sm text-gray-500 text-center px-4">
                We&apos;ve received your order and will be in touch to arrange delivery.
              </p>
              {txHash ? (
                <Link
                  href={`${EXPLORER_BASE}/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-[#238D9D]"
                >
                  View payment transaction →
                </Link>
              ) : null}
              <Button
                className="w-full rounded-xl bg-[#238D9D1A] text-[#238D9D] h-[56px] font-medium text-lg"
                onClick={() => onOpenChange(false)}
                title="Close"
              >
                Close
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {errorModal ? (
        <FeedbackDialog
          open={true}
          title={errorModal.title}
          description={errorModal.desc}
          onClose={() => setErrorModal(null)}
        />
      ) : null}

      {merchantSlug && merchantImage ? (
        <MerchantVoucherSheet
          open={merchantVoucherSheetOpen}
          onOpenChange={setMerchantVoucherSheetOpen}
          merchantSlug={merchantSlug}
          image={merchantImage}
        />
      ) : null}
    </>
  );
}
