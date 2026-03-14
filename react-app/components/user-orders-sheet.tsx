"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { CaretLeft, Package, CheckCircle, Clock, XCircle } from "@phosphor-icons/react";

const EXPLORER_BASE = "https://celoscan.io/tx";

type Order = {
  id: string;
  product_name: string;
  payment_type: string;
  amount_paid_cusd: number;
  currency: string;
  status: string;
  miles_rewarded: boolean;
  miles_reward_status?: "pending" | "processing" | "completed" | "failed" | null;
  miles_reward_attempts?: number | null;
  miles_reward_tx_hash?: string | null;
  miles_reward_error?: string | null;
  created_at: string;
  recipient_name: string;
  phone: string;
  city: string;
  delivery_fee_tx_hash: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  address: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:   { label: "Pending",   color: "text-amber-600 bg-amber-50",  icon: <Clock size={14} weight="fill" /> },
  processing:{ label: "Processing",color: "text-blue-600 bg-blue-50",    icon: <Clock size={14} weight="fill" /> },
  delivered: { label: "Delivered", color: "text-green-600 bg-green-50",  icon: <CheckCircle size={14} weight="fill" /> },
  cancelled: { label: "Cancelled", color: "text-red-500 bg-red-50",      icon: <XCircle size={14} weight="fill" /> },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function paymentLabel(type: string) {
  if (type === "voucher_free") return "Free (voucher)";
  if (type === "voucher_discount") return "Discounted";
  return "Full price";
}

function rewardLabel(order: Order) {
  if (order.miles_reward_status === "completed" || order.miles_rewarded) {
    return "+200 AkibaMiles earned";
  }
  if (order.miles_reward_status === "failed") {
    return "Reward processing failed";
  }
  if (order.miles_reward_status === "processing") {
    return "Processing reward";
  }
  return "Reward pending";
}

export default function UserOrdersSheet({ open, onOpenChange, address }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);

  useEffect(() => {
    if (!open || !address) return;

    let active = true;
    setLoading(true);
    setSelected(null);

    fetch(`/api/Spend/orders/user/${address}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => { if (active) setOrders(json?.orders ?? []); })
      .catch(console.error)
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [open, address]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-white rounded-t-xl font-sterling max-h-[90vh] overflow-auto p-4"
      >
        <SheetHeader className="pt-2 mb-4"><SheetTitle></SheetTitle></SheetHeader>

        {selected ? (
          /* ── Order detail ── */
          <div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex items-center gap-1 text-sm text-gray-500 mb-4"
            >
              <CaretLeft size={16} /> Back
            </button>

            <div className="flex items-center gap-2 mb-1">
              {(() => {
                const cfg = STATUS_CONFIG[selected.status] ?? STATUS_CONFIG.pending;
                return (
                  <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 ${cfg.color}`}>
                    {cfg.icon}{cfg.label}
                  </span>
                );
              })()}
            </div>

            <h2 className="text-xl font-semibold text-black mb-1">{selected.product_name}</h2>
            <p className="text-xs text-gray-400 mb-5">Order #{selected.id.slice(0, 8).toUpperCase()} · {fmtDate(selected.created_at)}</p>

            <div className="rounded-xl border border-gray-100 divide-y divide-gray-100 text-sm mb-5">
              {[
                ["Recipient",  selected.recipient_name],
                ["Phone",      selected.phone],
                ["City",       selected.city],
                ["Payment",    paymentLabel(selected.payment_type)],
                ["Amount paid",`$${selected.amount_paid_cusd.toFixed(2)} ${selected.currency}`],
                ["Miles",      rewardLabel(selected)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between px-4 py-3">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-medium text-black text-right max-w-[55%]">{value}</span>
                </div>
              ))}
            </div>

            {selected.miles_reward_status === "failed" && selected.miles_reward_error ? (
              <p className="text-xs text-amber-600 mb-4">
                Reward issue: {selected.miles_reward_error}
              </p>
            ) : null}

            <Link
              href={`${EXPLORER_BASE}/${selected.delivery_fee_tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#238D9D]"
            >
              View payment transaction →
            </Link>
          </div>

        ) : (
          /* ── Orders list ── */
          <div>
            <div className="flex flex-col items-start mb-5">
              <span className="text-xs font-medium bg-[#24E5E033] text-[#1E8C89] rounded-full px-3 py-0.5 mb-2">
                History
              </span>
              <h2 className="text-black font-semibold text-2xl leading-tight">My Orders</h2>
              <p className="text-sm text-gray-500 mt-1">Your recent purchases</p>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-40">
                <p className="text-gray-500 text-sm">Loading orders…</p>
              </div>
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
                  <Package size={28} color="#9ca3af" weight="duotone" />
                </div>
                <p className="text-sm text-gray-500">No orders yet</p>
              </div>
            ) : (
              <div className="space-y-3 pb-4">
                {orders.map((order) => {
                  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;
                  return (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => setSelected(order)}
                      className="w-full rounded-xl border border-gray-100 p-4 text-left hover:border-[#238D9D] transition-colors active:scale-[0.99]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-black truncate">{order.product_name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{fmtDate(order.created_at)}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2 py-0.5 ${cfg.color}`}>
                            {cfg.icon}{cfg.label}
                          </span>
                          <span className="text-xs text-gray-500">
                            ${order.amount_paid_cusd.toFixed(2)} {order.currency}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
