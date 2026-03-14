// src/components/dashboard-header.tsx
import { GearSvg } from "@/lib/svg";
import { Question, Ticket, Storefront, Package } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";

export default function DashboardHeader({
  name,
  onOpenVouchers,
  onOpenShop,
  onOpenOrders,
}: {
  name: any;
  onOpenVouchers?: () => void;
  onOpenShop?: () => void;
  onOpenOrders?: () => void;
}) {
  return (
    <div className="px-4 pt-4 flex justify-between items-center">
      <h1 className="text-xl font-medium">Welcome {name}!</h1>

      <div className="flex items-center gap-3">
        {/* Open user vouchers */}
        <button
          type="button"
          onClick={onOpenVouchers}
          aria-label="View my vouchers"
          title="My Vouchers"
          className="inline-flex items-center justify-center rounded-lg p-1.5 hover:bg-black/5 active:scale-[0.98]"
        >
          <Ticket size={24} color="#238D9D" weight="duotone" />
        </button>

        {/* Shop */}
        <button
          type="button"
          onClick={onOpenShop}
          aria-label="Shop"
          title="Shop"
          className="inline-flex items-center justify-center rounded-lg p-1.5 hover:bg-black/5 active:scale-[0.98]"
        >
          <Storefront size={24} color="#238D9D" weight="duotone" />
        </button>

        {/* My Orders */}
        <button
          type="button"
          onClick={onOpenOrders}
          aria-label="My orders"
          title="My Orders"
          className="inline-flex items-center justify-center rounded-lg p-1.5 hover:bg-black/5 active:scale-[0.98]"
        >
          <Package size={24} color="#238D9D" weight="duotone" />
        </button>

        {/* Settings */}
        <Link href="/settings" aria-label="Settings">
          <Image src={GearSvg} alt="" />
        </Link>

        {/* Help / Onboarding */}
        <Link href="/onboarding" aria-label="Help & onboarding">
          <Question size={24} color="#238D9D" weight="duotone" />
        </Link>
      </div>
    </div>
  );
}
