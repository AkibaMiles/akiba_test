export type VoucherIssueProofPayload = {
  address: `0x${string}`;
  merchant_id: string;
  voucher_template_id: string;
  timestamp: number;
  nonce: string;
};

export function buildVoucherIssueMessage(payload: VoucherIssueProofPayload) {
  return [
    "AkibaMiles Voucher Issue Authorization",
    `address:${payload.address.toLowerCase()}`,
    `merchant_id:${payload.merchant_id}`,
    `voucher_template_id:${payload.voucher_template_id}`,
    `timestamp:${payload.timestamp}`,
    `nonce:${payload.nonce}`,
  ].join("\n");
}

export function isFreshVoucherProofTimestamp(
  timestamp: number,
  maxSkewMs = 5 * 60 * 1000
) {
  if (!Number.isFinite(timestamp)) return false;
  const age = Math.abs(Date.now() - timestamp);
  return age <= maxSkewMs;
}
