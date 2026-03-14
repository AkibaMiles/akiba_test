"use client";

import React, { useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Tag, ShoppingBag } from "@phosphor-icons/react";
import MerchantVoucherSheet from "./merchant-voucher-sheet";
import VoucherOrderSheet from "./voucher-order-sheet";
import type { SpendMerchant } from "@/helpers/spendMerchants";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchant: SpendMerchant | null;
  image: StaticImageData;
};

export default function MerchantActionsSheet({
  open,
  onOpenChange,
  merchant,
  image,
}: Props) {
  const [voucherSheetOpen, setVoucherSheetOpen] = useState(false);
  const [shopSheetOpen, setShopSheetOpen] = useState(false);

  if (!merchant) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="bg-white rounded-t-xl font-sterling p-4"
        >
          <SheetHeader className="pt-2 mb-5">
            <SheetTitle></SheetTitle>
          </SheetHeader>

          {/* Merchant identity */}
          <div className="flex items-center gap-3 mb-6">
            <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-gray-100">
              <Image src={image} alt={merchant.name} fill className="object-cover" />
            </div>
            <div>
              <p className="font-semibold text-lg text-black leading-tight">{merchant.name}</p>
              <p className="text-sm text-gray-500">{merchant.country}</p>
            </div>
          </div>

          {/* Action cards */}
          <div className="grid grid-cols-2 gap-3 pb-6">
            {/* Buy Voucher */}
            <button
              type="button"
              title="Buy Voucher"
              onClick={() => {
                onOpenChange(false);
                setVoucherSheetOpen(true);
              }}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 border-gray-100 bg-gray-50 p-5 text-center transition-colors active:scale-[0.97] hover:border-[#238D9D] hover:bg-[#238D9D08]"
            >
              <div className="w-12 h-12 rounded-full bg-[#238D9D] flex items-center justify-center">
                <Tag size={22} weight="bold" color="white" />
              </div>
              <p className="font-semibold text-sm text-black">Buy Voucher</p>
              <p className="text-xs text-gray-500 leading-snug">
                Redeem miles for discounts &amp; free items
              </p>
            </button>

            {/* Shop */}
            <button
              type="button"
              title="Shop"
              onClick={() => {
                onOpenChange(false);
                setShopSheetOpen(true);
              }}
              className="flex flex-col items-center gap-2 rounded-2xl border-2 border-gray-100 bg-gray-50 p-5 text-center transition-colors active:scale-[0.97] hover:border-[#238D9D] hover:bg-[#238D9D08]"
            >
              <div className="w-12 h-12 rounded-full bg-[#238D9D1A] flex items-center justify-center">
                <ShoppingBag size={22} weight="bold" color="#238D9D" />
              </div>
              <p className="font-semibold text-sm text-black">Shop</p>
              <p className="text-xs text-gray-500 leading-snug">
                Order products with home delivery
              </p>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <MerchantVoucherSheet
        open={voucherSheetOpen}
        onOpenChange={setVoucherSheetOpen}
        merchantSlug={merchant.slug}
        image={image}
      />

      <VoucherOrderSheet
        open={shopSheetOpen}
        onOpenChange={setShopSheetOpen}
        merchantId={merchant.id}
        merchantName={merchant.name}
        merchantSlug={merchant.slug}
        merchantImage={image}
      />
    </>
  );
}
