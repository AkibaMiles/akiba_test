"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Button } from "./ui/button";
import { CaretLeft, Copy, Share } from "@phosphor-icons/react";
import { copyTextRobust } from "@/lib/clipboard";
import VoucherOrderSheet from "./voucher-order-sheet";

type UserVoucher = {
  id: string;
  code: string;
  qr_payload: string;
  expires_at: string;
  burn_tx_hash: string;
  status: string;
  rules_snapshot: string[];
  created_at: string;
  merchant_id: string;
  merchant_name: string;
  voucher_title: string;
  miles_cost: number | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  address: string | null;
};

const explorerBase = "https://celoscan.io/tx";

function fmtDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export default function UserVouchersSheet({ open, onOpenChange, address }: Props) {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<UserVoucher[]>([]);
  const [selected, setSelected] = useState<UserVoucher | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (!address) {
      setItems([]);
      setSelected(null);
      setError("Connect your wallet to view vouchers.");
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    setSelected(null);

    fetch(`/api/Spend/vouchers/user/${address}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error ?? "Failed to load vouchers");
        }
        if (!active) return;
        setItems((json?.vouchers ?? []) as UserVoucher[]);
      })
      .catch((err: any) => {
        if (!active) return;
        setItems([]);
        setError(err?.message ?? "Failed to load vouchers");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, address]);

  const qrImage = useMemo(() => {
    if (!selected?.qr_payload) return null;
    const payload = encodeURIComponent(selected.qr_payload);
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${payload}`;
  }, [selected]);

  const handleCopyCode = async (code: string) => {
    const result = await copyTextRobust(code);
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      return;
    }
    if (result === "manual") {
      setError("Use the popup field to copy the voucher code manually.");
      return;
    }
    setError("Unable to copy voucher code on this device.");
  };

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="bg-white rounded-t-xl font-sterling max-h-[90vh] overflow-auto p-3"
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64">
            <p className="text-gray-500">Loading vouchers…</p>
          </div>
        ) : selected ? (
          <div className="flex flex-col justify-center h-full p-4 space-y-4">
            <div className="flex items-center justify-between">
              <CaretLeft
                size={24}
                className="cursor-pointer"
                onClick={() => setSelected(null)}
              />
            </div>

            <h3 className="font-bold text-lg text-center">{selected.voucher_title}</h3>
            <p className="text-center text-sm text-gray-600">{selected.merchant_name}</p>

            <div className="rounded-xl border border-gray-200 p-4 flex flex-col items-center gap-3">
              {qrImage ? (
                <Image src={qrImage} alt="Voucher QR" width={220} height={220} unoptimized />
              ) : null}
              <div className="w-full rounded-lg bg-[#F7F8F8] p-3 text-center">
                <p className="text-xs text-gray-500">Voucher code</p>
                <p className="text-xl font-semibold tracking-widest mt-1">{selected.code}</p>
                <button
                  type="button"
                  onClick={() => handleCopyCode(selected.code)}
                  className="mt-2 inline-flex items-center gap-1 text-sm text-[#238D9D] font-medium"
                >
                  <Copy size={14} />
                  {copied ? "Copied" : "Copy code"}
                </button>
              </div>
              <p className="text-xs text-gray-600">Expires: {fmtDate(selected.expires_at)}</p>
              <p className="text-xs text-gray-600">Status: {selected.status}</p>
            </div>

            {selected.burn_tx_hash ? (
              <Link
                href={`${explorerBase}/${selected.burn_tx_hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1 font-medium text-[#238D9D]"
              >
                View burn transaction <Share size={18} />
              </Link>
            ) : null}

            {selected.status === "issued" && (
              <Button
                    className="w-full rounded-xl bg-[#238D9D] text-white font-medium text-lg h-[56px]"
                    onClick={() => setOrderSheetOpen(true)} title={"Order goods"}              >
                Order goods
              </Button>
            )}

            <Button
              className="w-full rounded-xl bg-[#238D9D1A] text-[#238D9D] py-4 font-medium text-lg h-[56px]"
              onClick={() => onOpenChange(false)}
              title="Close"
            >
              Close
            </Button>
          </div>
        ) : (
          <div>
            <SheetHeader className="pt-4">
              <SheetTitle></SheetTitle>
            </SheetHeader>

            <div className="flex flex-col justify-start items-start mb-4">
              <h3 className="text-sm font-medium bg-[#24E5E033] text-[#1E8C89] rounded-full px-3">
                My vouchers
              </h3>
              <h2 className="text-black font-medium text-3xl my-2">Voucher Wallet</h2>
              <p className="text-sm text-gray-600">All generated merchant vouchers</p>
            </div>

            {error ? <p className="text-sm text-red-600 mb-3">{error}</p> : null}

            <div className="space-y-3 mb-4">
              {items.map((voucher) => (
                <button
                  type="button"
                  key={voucher.id}
                  onClick={() => setSelected(voucher)}
                  className="w-full text-left rounded-xl border border-gray-200 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-black">{voucher.voucher_title}</p>
                      <p className="text-sm text-gray-600">{voucher.merchant_name}</p>
                    </div>
                    <span className="text-xs font-medium bg-[#238D9D1A] text-[#238D9D] rounded-full px-2 py-1">
                      {voucher.miles_cost ? `${voucher.miles_cost} Miles` : "Voucher"}
                    </span>
                  </div>

                  <div className="mt-2 text-xs text-gray-600 flex justify-between">
                    <span>Code: {voucher.code}</span>
                    <span>Expires: {fmtDate(voucher.expires_at)}</span>
                  </div>
                </button>
              ))}

              {!error && items.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">
                  You do not have any vouchers yet.
                </p>
              ) : null}
            </div>

            <Button
              onClick={() => onOpenChange(false)}
              className="w-full bg-[#238D9D1A] text-[#238D9D] rounded-xl h-[56px] font-medium"
              title="Close"
            >
              Close
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>

    <VoucherOrderSheet
      open={orderSheetOpen}
      onOpenChange={setOrderSheetOpen}
      voucher={
        selected
          ? {
              id: selected.id,
              merchant_id: selected.merchant_id,
              merchant_name: selected.merchant_name,
              voucher_title: selected.voucher_title,
              status: selected.status,
            }
          : null
      }
    />
    </>
  );
}
