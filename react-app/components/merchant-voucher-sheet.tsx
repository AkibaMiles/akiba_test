"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { Button } from "./ui/button";
import { CaretLeft, Copy } from "@phosphor-icons/react";
import { akibaMilesSymbol } from "@/lib/svg";
import { useWeb3 } from "@/contexts/useWeb3";
import { copyTextRobust } from "@/lib/clipboard";
import {
  fetchSpendMerchantDetail,
  issueSpendVoucher,
  type IssuedVoucher,
  type SpendMerchantDetail,
  type SpendVoucherTemplate,
} from "@/helpers/spendMerchants";
import FeedbackDialog from "./FeedbackDialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  merchantSlug: string | null;
  image: StaticImageData;
};

const fmtDate = (iso: string | null) => {
  if (!iso) return "No expiry";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No expiry";
  return d.toLocaleString();
};

function VoucherRow({
  template,
  onGenerate,
  disabled,
}: {
  template: SpendVoucherTemplate;
  onGenerate: (template: SpendVoucherTemplate) => void;
  disabled: boolean;
}) {
  const expired =
    !!template.expires_at && new Date(template.expires_at).getTime() <= Date.now();

  return (
    <div className="rounded-xl border border-gray-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-base font-medium text-black">{template.title}</h4>
          {template.description ? (
            <p className="text-sm text-gray-600 mt-1">{template.description}</p>
          ) : null}
        </div>
        <span className="text-xs font-medium bg-[#238D9D1A] text-[#238D9D] rounded-full px-2 py-1 whitespace-nowrap flex items-center">
          <Image src={akibaMilesSymbol} alt="" width={12} height={12} className="mr-1" />
          {template.miles_cost}
        </span>
      </div>

      <div className="mt-2 text-xs text-gray-600 flex justify-between">
        <span>Expires</span>
        <span>{fmtDate(template.expires_at)}</span>
      </div>

      <Button
        onClick={() => onGenerate(template)}
        disabled={disabled || !template.active || expired}
        title="Generate Voucher"
        className="w-full mt-3 bg-[#238D9D] text-white rounded-xl h-[44px] font-medium"
      >
        Generate Voucher
      </Button>
    </div>
  );
}

export default function MerchantVoucherSheet({
  open,
  onOpenChange,
  merchantSlug,
  image,
}: Props) {
  const { address, getUserAddress, signVoucherIssueProof } = useWeb3();

  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [merchant, setMerchant] = useState<SpendMerchantDetail | null>(null);
  const [issued, setIssued] = useState<IssuedVoucher | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorModal, setErrorModal] = useState<{ title: string; desc?: string } | null>(null);

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    if (!open || !merchantSlug) return;

    let active = true;
    setLoading(true);
    setMerchant(null);
    setIssued(null);

    fetchSpendMerchantDetail(merchantSlug)
      .then((detail) => {
        if (!active) return;
        setMerchant(detail);
      })
      .catch((err: any) => {
        if (!active) return;
        setErrorModal({
          title: "Failed to load merchant",
          desc: err?.message ?? "Please try again.",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, merchantSlug]);

  const handleCopyCode = async (code: string) => {
    const result = await copyTextRobust(code);
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      return;
    }
    if (result === "manual") {
      setErrorModal({
        title: "Manual copy",
        desc: "Use the popup field to copy the voucher code.",
      });
      return;
    }
    setErrorModal({ title: "Copy failed", desc: "Unable to copy voucher code." });
  };

  const qrImage = useMemo(() => {
    if (!issued?.qr_payload) return null;
    const payload = encodeURIComponent(issued.qr_payload);
    return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${payload}`;
  }, [issued]);

  const handleGenerate = async (template: SpendVoucherTemplate) => {
    if (!merchant || !address) {
      setErrorModal({
        title: "Wallet required",
        desc: "Connect wallet before generating a voucher.",
      });
      return;
    }

    try {
      setProcessing(true);
      const idempotencyKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const proof = await signVoucherIssueProof({
        merchant_id: merchant.id,
        voucher_template_id: template.id,
      });

      const result = await issueSpendVoucher({
        merchant_id: merchant.id,
        voucher_template_id: template.id,
        user_address: address,
        proof: {
          address: proof.address,
          timestamp: proof.timestamp,
          nonce: proof.nonce,
          signature: proof.signature,
        },
        idempotency_key: idempotencyKey,
      });
      setIssued(result);
      window.dispatchEvent(new Event("akiba:miles:refresh"));
    } catch (err: any) {
      setErrorModal({
        title: "Voucher generation failed",
        desc: err?.message ?? "Please try again.",
      });
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
          {loading || processing ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <p className="text-gray-500">Processing…</p>
            </div>
          ) : issued ? (
            <div className="flex flex-col justify-center h-full p-4 space-y-4">
              <div className="flex items-center justify-between">
                <CaretLeft
                  size={24}
                  className="cursor-pointer"
                  onClick={() => setIssued(null)}
                />
              </div>

              <h3 className="font-bold text-lg text-center">Your voucher is ready</h3>

              <div className="rounded-xl border border-gray-200 p-4 flex flex-col items-center gap-3">
                {qrImage ? (
                  <Image
                    src={qrImage}
                    alt="Voucher QR"
                    width={220}
                    height={220}
                    unoptimized
                  />
                ) : null}
                <div className="w-full rounded-lg bg-[#F7F8F8] p-3 text-center">
                  <p className="text-xs text-gray-500">Voucher code</p>
                  <p className="text-xl font-semibold tracking-widest mt-1">
                    {issued.voucher_code}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleCopyCode(issued.voucher_code)}
                    className="mt-2 inline-flex items-center gap-1 text-sm text-[#238D9D] font-medium"
                  >
                    <Copy size={14} />
                    {copied ? "Copied" : "Copy code"}
                  </button>
                </div>
                <p className="text-xs text-gray-600">Expires: {fmtDate(issued.expires_at)}</p>
              </div>

              <Button
                className="w-full rounded-xl bg-[#238D9D1A] text-[#238D9D] py-4 font-medium text-lg h-[56px]"
                onClick={() => onOpenChange(false)}
                title="Close"
              >
                Close
              </Button>
            </div>
          ) : merchant ? (
            <div>
              <SheetHeader className="pt-4">
                <SheetTitle></SheetTitle>
              </SheetHeader>

              <div className="flex flex-col justify-start items-start mb-2">
                <h3 className="text-sm font-medium bg-[#24E5E033] text-[#1E8C89] rounded-full px-3">
                  Merchant vouchers
                </h3>
                <h2 className="text-black font-medium text-3xl my-2">{merchant.name}</h2>
              </div>

              <div className="relative w-full h-40 rounded-xl overflow-hidden mb-4">
                <Image src={image} alt={`${merchant.name} banner`} fill className="object-cover" />
              </div>

              <div className="mb-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="font-medium">Country</span>
                  <span className="text-gray-700">{merchant.country}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Vouchers available</span>
                  <span className="text-gray-700">{merchant.vouchers_available}</span>
                </div>
              </div>

              <p className="text-center text-xl font-medium mb-4">Voucher templates</p>

              <div className="space-y-3 mb-4">
                {merchant.vouchers.map((template) => (
                  <VoucherRow
                    key={template.id}
                    template={template}
                    onGenerate={handleGenerate}
                    disabled={processing}
                  />
                ))}

                {merchant.vouchers.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center">No vouchers currently available.</p>
                ) : null}
              </div>

              <SheetFooter className="flex flex-col w-full space-y-2">
                <Button
                  onClick={() => onOpenChange(false)}
                  className="w-full bg-[#238D9D1A] text-[#238D9D] rounded-xl h-[56px] font-medium"
                  title="Close"
                >
                  Close
                </Button>
              </SheetFooter>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
              <p className="text-gray-500">Merchant not found.</p>
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
    </>
  );
}
