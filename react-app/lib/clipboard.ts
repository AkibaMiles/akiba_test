export type CopyResult = "copied" | "manual" | "failed";

function isMiniPayWebView() {
  try {
    return Boolean((window as any)?.ethereum?.isMiniPay);
  } catch {
    return false;
  }
}

export async function copyTextRobust(text: string): Promise<CopyResult> {
  if (!text) return "failed";

  // MiniPay WebView can report clipboard success without a real paste buffer update.
  // Prefer manual flow there to avoid false "Copied" confirmations.
  if (typeof window !== "undefined" && isMiniPayWebView()) {
    try {
      if (typeof window.prompt === "function") {
        window.prompt("Copy voucher code:", text);
        return "manual";
      }
    } catch {
      return "failed";
    }
    return "failed";
  }

  // 1) Modern clipboard API
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      // Verify write when readText is available.
      if (navigator.clipboard.readText) {
        try {
          const readBack = await navigator.clipboard.readText();
          if (readBack === text) return "copied";
          return "manual";
        } catch {
          // Some browsers disallow readText; keep optimistic only outside MiniPay.
          return "copied";
        }
      }
      return "copied";
    }
  } catch {
    // fallback below
  }

  // 2) Legacy copy command fallback (works in some WebViews)
  try {
    if (typeof document !== "undefined") {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      textarea.style.pointerEvents = "none";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      if (ok) return "copied";
    }
  } catch {
    // fallback below
  }

  // 3) Last-resort manual copy prompt
  try {
    if (typeof window !== "undefined" && typeof window.prompt === "function") {
      window.prompt("Copy voucher code:", text);
      return "manual";
    }
  } catch {
    // no-op
  }

  return "failed";
}
