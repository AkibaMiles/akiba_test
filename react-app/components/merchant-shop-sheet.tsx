"use client";

import React, { useEffect, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { fetchSpendMerchants, type SpendMerchant } from "@/helpers/spendMerchants";
import { leshan } from "@/lib/img";
import MerchantActionsSheet from "./merchant-actions-sheet";

// Image map — extend as more merchants are added
const MERCHANT_IMAGES: Record<string, StaticImageData> = {
  leshan,
  default: leshan,
};

function pickMerchantImage(merchant: SpendMerchant): StaticImageData {
  const key = (merchant.image_key ?? "").toLowerCase();
  return MERCHANT_IMAGES[key] ?? MERCHANT_IMAGES.default;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function MerchantShopSheet({ open, onOpenChange }: Props) {
  const [merchants, setMerchants] = useState<SpendMerchant[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<SpendMerchant | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    let active = true;
    setLoading(true);

    fetchSpendMerchants()
      .then((data) => { if (active) setMerchants(data); })
      .catch(console.error)
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [open]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="bg-white rounded-t-xl font-sterling max-h-[90vh] overflow-auto p-4"
        >
          <SheetHeader className="pt-2 mb-4">
            <SheetTitle></SheetTitle>
          </SheetHeader>

          <div className="flex flex-col items-start mb-5">
            <span className="text-xs font-medium bg-[#24E5E033] text-[#1E8C89] rounded-full px-3 py-0.5 mb-2">
              Shop
            </span>
            <h2 className="text-black font-semibold text-2xl leading-tight">Our Partners</h2>
            <p className="text-sm text-gray-500 mt-1">Buy vouchers or shop &amp; order goods</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-gray-500 text-sm">Loading merchants…</p>
            </div>
          ) : merchants.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">No merchants available.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 pb-4">
              {merchants.map((merchant) => {
                const img = pickMerchantImage(merchant);
                return (
                  <button
                    key={merchant.id}
                    type="button"
                    onClick={() => {
                      setSelectedMerchant(merchant);
                      setActionsOpen(true);
                    }}
                    className="rounded-xl border border-gray-200 overflow-hidden text-left hover:border-[#238D9D] transition-colors active:scale-[0.98]"
                  >
                    <div className="relative w-full h-28">
                      <Image src={img} alt={merchant.name} fill className="object-cover" />
                    </div>
                    <div className="p-3">
                      <p className="font-semibold text-sm text-black leading-tight">{merchant.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{merchant.country}</p>
                      <p className="text-xs text-[#238D9D] mt-1">
                        {merchant.vouchers_available} voucher{merchant.vouchers_available === 1 ? "" : "s"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <MerchantActionsSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        merchant={selectedMerchant}
        image={selectedMerchant ? pickMerchantImage(selectedMerchant) : MERCHANT_IMAGES.default}
      />
    </>
  );
}
