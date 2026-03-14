"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import type { ClawRewardClass } from "@/lib/clawGame";

export type ClawGameState =
  | "idle"
  | "starting"
  | "pending"
  | "ready"
  | "settling"
  | "settled";

type Props = {
  gameState: ClawGameState;
  rewardClass: ClawRewardClass;
  className?: string;
};

const REWARD_CFG: Record<
  ClawRewardClass,
  { emoji: string; label: string; glow: string; gradTop: string; gradBot: string }
> = {
  none:      { emoji: "?",  label: "—",             glow: "rgba(100,116,139,0.4)", gradTop: "#334155", gradBot: "#0f172a" },
  lose:      { emoji: "💨", label: "No grab",        glow: "rgba(100,116,139,0.4)", gradTop: "#475569", gradBot: "#0f172a" },
  common:    { emoji: "🪙", label: "Miles reward",   glow: "rgba(16,185,129,0.85)", gradTop: "#34d399", gradBot: "#064e3b" },
  rare:      { emoji: "🎫", label: "Rare voucher",   glow: "rgba(6,182,212,0.85)",  gradTop: "#22d3ee", gradBot: "#164e63" },
  epic:      { emoji: "💎", label: "USDT payout",    glow: "rgba(139,92,246,0.85)", gradTop: "#a78bfa", gradBot: "#3b0764" },
  legendary: { emoji: "⭐", label: "Legendary!",     glow: "rgba(251,191,36,0.95)", gradTop: "#fde68a", gradBot: "#78350f" },
};

const FLOATERS = [
  { gradTop: "#34d399", gradBot: "#064e3b", glow: "rgba(16,185,129,0.65)",  emoji: "🪙", top: "20%", left: "8%",  dur: "3.3s", delay: "0s"   },
  { gradTop: "#22d3ee", gradBot: "#164e63", glow: "rgba(6,182,212,0.65)",   emoji: "🎫", top: "6%",  left: "44%", dur: "2.9s", delay: "0.5s" },
  { gradTop: "#a78bfa", gradBot: "#3b0764", glow: "rgba(139,92,246,0.65)",  emoji: "💎", top: "50%", left: "62%", dur: "3.6s", delay: "0.3s" },
  { gradTop: "#fde68a", gradBot: "#78350f", glow: "rgba(251,191,36,0.75)",  emoji: "⭐", top: "16%", left: "74%", dur: "2.6s", delay: "0.8s" },
  { gradTop: "#fb923c", gradBot: "#7c2d12", glow: "rgba(249,115,22,0.55)",  emoji: "🎁", top: "56%", left: "24%", dur: "3.8s", delay: "0.6s" },
  { gradTop: "#94a3b8", gradBot: "#1e293b", glow: "rgba(148,163,184,0.35)", emoji: "💰", top: "38%", left: "10%", dur: "4.1s", delay: "1.2s" },
];

const LED_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#8b5cf6", "#ec4899"];

const CONFETTI_EMOJIS = ["🪙", "🎫", "💎", "⭐", "✨", "🎉", "🎊"];
const CONFETTI_PIECES = Array.from({ length: 14 }, (_, i) => ({
  emoji: CONFETTI_EMOJIS[i % CONFETTI_EMOJIS.length],
  left: `${6 + (i * 6.5) % 88}%`,
  dur: `${0.9 + (i % 5) * 0.18}s`,
  delay: `${(i % 7) * 0.07}s`,
  rotate: `${(i % 2 === 0 ? 1 : -1) * (15 + (i % 4) * 10)}deg`,
}));

// Machine dimensions
const W  = 220;
const HH = 68;   // housing height
const GH = 116;  // glass height
const BH = 22;   // base height

export function ClawMachineDisplay({ gameState, rewardClass, className = "" }: Props) {
  const [clawY, setClawY] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const prevGameState = useRef<ClawGameState>("idle");
  const rc = REWARD_CFG[rewardClass] ?? REWARD_CFG.none;

  useEffect(() => {
    const dropped = gameState === "pending" || gameState === "ready";
    setClawY(dropped ? 68 : 0);
  }, [gameState]);

  useEffect(() => {
    const worthCelebrating = rewardClass !== "lose" && rewardClass !== "none";
    if (gameState === "settled" && prevGameState.current !== "settled" && worthCelebrating) {
      setShowConfetti(true);
      const t = setTimeout(() => setShowConfetti(false), 2200);
      return () => clearTimeout(t);
    }
    prevGameState.current = gameState;
  }, [gameState, rewardClass]);

  const isIdle    = gameState === "idle";
  const isPending = gameState === "pending" || gameState === "starting";
  const isReady   = gameState === "ready";
  const isSettled = gameState === "settled";

  const stateMsg = useMemo(() => {
    switch (gameState) {
      case "idle":     return "Pick a tier and start your pull";
      case "starting": return "Submitting transaction…";
      case "pending":  return "Claw grabbing — oracle resolving…";
      case "ready":    return "Oracle ready — tap Reveal!";
      case "settling": return "Lifting your prize…";
      case "settled":
        return rewardClass === "lose"
          ? "No grab this time — try again?"
          : `You won: ${rc.label}`;
    }
  }, [gameState, rewardClass, rc.label]);

  return (
    <div className={`relative flex flex-col items-center justify-center select-none ${className}`}>
      {/* ── Keyframes ── */}
      <style>{`
        @keyframes cPrizFloat {
          0%,100% { transform: translateY(0px) rotate(0deg)  scale(1);    }
          50%     { transform: translateY(-9px) rotate(4deg) scale(1.04); }
        }
        @keyframes cSway {
          0%,100% { transform: translateX(0px); }
          30%     { transform: translateX(-10px); }
          70%     { transform: translateX(10px); }
        }
        @keyframes cNeon {
          0%,100% { opacity: 1; }
          47%,53% { opacity: 0.3; }
        }
        @keyframes cReveal {
          0%   { transform: scale(0.3) rotate(-12deg); opacity: 0; }
          68%  { transform: scale(1.14) rotate(3deg);  opacity: 1; }
          100% { transform: scale(1)   rotate(0deg);   opacity: 1; }
        }
        @keyframes cGlow {
          0%,100% { filter: brightness(1)   drop-shadow(0 0 5px rgba(6,182,212,0.7)); }
          50%     { filter: brightness(1.6) drop-shadow(0 0 14px rgba(6,182,212,1)); }
        }
        @keyframes cScan {
          0%   { transform: translateY(-4px); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(${GH + 8}px); opacity: 0; }
        }
        @keyframes cLegendaryPulse {
          0%,100% { box-shadow: 0 0 24px rgba(251,191,36,0.7), 0 0 48px rgba(251,191,36,0.25); }
          50%     { box-shadow: 0 0 48px rgba(251,191,36,1),   0 0 96px rgba(251,191,36,0.5), 0 0 140px rgba(251,191,36,0.2); }
        }
        @keyframes cConfettiFall {
          0%   { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(200px) rotate(var(--cr)); opacity: 0; }
        }
        @keyframes cLedPulse {
          0%,100% { opacity: 0.65; transform: scale(1); }
          50%     { opacity: 1;    transform: scale(1.3); }
        }
        @keyframes cMotorPulse {
          0%,100% { opacity: 0.5; }
          50%     { opacity: 1; }
        }
      `}</style>

      {/* ── Confetti burst ── */}
      {showConfetti && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 10 }}>
          {CONFETTI_PIECES.map((p, i) => (
            <span
              key={i}
              className="absolute text-base"
              style={{
                left: p.left,
                top: "8%",
                "--cr": p.rotate,
                animation: `cConfettiFall ${p.dur} ease-in forwards`,
                animationDelay: p.delay,
              } as React.CSSProperties}
            >
              {p.emoji}
            </span>
          ))}
        </div>
      )}

      {/* ── Machine body ── */}
      <div className="relative" style={{ width: W }}>

        {/* ── TOP HOUSING ── */}
        <div
          className="relative rounded-t-[22px] border-2 border-b-0 overflow-hidden"
          style={{
            height: HH,
            background: "linear-gradient(175deg, #2a3f58 0%, #1a2d44 45%, #0e1b2e 100%)",
            borderColor: "#3a5270",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07)",
          }}
        >
          {/* Top metallic sheen */}
          <div
            className="pointer-events-none absolute inset-x-8 top-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)" }}
          />

          {/* Side accent lines */}
          <div className="pointer-events-none absolute inset-y-4 left-3 w-px" style={{ background: "linear-gradient(180deg, transparent, rgba(99,179,237,0.15), transparent)" }} />
          <div className="pointer-events-none absolute inset-y-4 right-3 w-px" style={{ background: "linear-gradient(180deg, transparent, rgba(99,179,237,0.15), transparent)" }} />

          {/* AKIBA CLAW neon sign */}
          <div
            className="pointer-events-none absolute inset-x-0 top-2.5 flex flex-col items-center gap-px"
            style={{ animation: "cNeon 3.5s ease-in-out infinite" }}
          >
            <span
              className="block text-[7px] font-black tracking-[0.52em] leading-none"
              style={{ color: "#7dd3fc", textShadow: "0 0 4px #38bdf8, 0 0 10px #0284c7, 0 0 18px #0369a1" }}
            >
              AKIBA
            </span>
            <span
              className="block text-[12px] font-black tracking-[0.58em] leading-none"
              style={{ color: "#e0f2fe", textShadow: "0 0 6px #38bdf8, 0 0 14px #06b6d4, 0 0 24px #0891b2, 0 0 1px #fff" }}
            >
              CLAW
            </span>
          </div>

          {/* Rainbow LED strip */}
          <div className="absolute inset-x-6 flex items-center justify-between" style={{ bottom: 28 }}>
            {LED_COLORS.map((color, i) => (
              <div
                key={i}
                className="rounded-full"
                style={{
                  width: 5, height: 5,
                  background: `radial-gradient(circle at 35% 35%, ${color}ff, ${color}88)`,
                  boxShadow: `0 0 5px ${color}, 0 0 8px ${color}80`,
                  animation: `cLedPulse ${1.1 + i * 0.13}s ease-in-out infinite`,
                  animationDelay: `${i * 0.11}s`,
                }}
              />
            ))}
          </div>

          {/* Rail */}
          <div
            className="absolute bottom-0 inset-x-4 rounded-full"
            style={{
              height: 10,
              background: "linear-gradient(180deg, #4a6a8a 0%, #1e3248 100%)",
              borderTop: "1px solid #5a8aaa",
              boxShadow: "0 2px 4px rgba(0,0,0,0.4)",
            }}
          />

          {/* Claw assembly */}
          <div className="absolute bottom-0 left-0 right-0 flex justify-center">
            {/* X sway */}
            <div style={{ animation: isIdle ? "cSway 4s ease-in-out infinite" : undefined }}>
              {/* Y drop */}
              <div
                className="flex flex-col items-center"
                style={{
                  transform: `translateY(${clawY}px)`,
                  transition: "transform 0.85s cubic-bezier(0.4,0,0.2,1)",
                }}
              >
                {/* Motor/pulley housing */}
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 22, height: 13,
                    background: "linear-gradient(180deg, #4a6a8a, #1a2e44)",
                    border: "1px solid #5a7a9a",
                    borderRadius: 3,
                    boxShadow: "0 2px 5px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)",
                  }}
                >
                  {/* Status LED on motor */}
                  <div
                    style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: isReady
                        ? "radial-gradient(circle at 35% 35%, #67e8f9, #0891b2)"
                        : "radial-gradient(circle at 35% 35%, #475569, #1e293b)",
                      boxShadow: isReady ? "0 0 6px #06b6d4, 0 0 10px #0891b2" : "none",
                      animation: isReady ? "cMotorPulse 0.8s ease-in-out infinite" : undefined,
                    }}
                  />
                </div>

                {/* Wire — double strand */}
                <div className="flex gap-px" style={{ height: 22 }}>
                  <div style={{ width: 1.5, height: "100%", background: "linear-gradient(180deg, #94a3b8, #475569)" }} />
                  <div style={{ width: 1, height: "100%", background: "linear-gradient(180deg, #cbd5e1, #64748b)", opacity: 0.5 }} />
                </div>

                {/* 5-prong claw */}
                <div
                  className="flex items-end justify-center"
                  style={{
                    gap: 1.5,
                    filter: isReady ? undefined : undefined,
                    animation: isReady ? "cGlow 1s ease-in-out infinite" : undefined,
                  }}
                >
                  {/* Left outer prong */}
                  <div style={{ width: 3, height: 22, borderBottom: "2.5px solid #94a3b8", borderLeft: "2px solid #94a3b8", borderBottomLeftRadius: "45%", transform: "rotate(-23deg)", transformOrigin: "top center" }} />
                  {/* Left inner prong */}
                  <div style={{ width: 2.5, height: 17, borderBottom: "2px solid #cbd5e1", borderLeft: "1.5px solid #cbd5e1", borderBottomLeftRadius: "55%", transform: "rotate(-9deg)", transformOrigin: "top center" }} />
                  {/* Center prong */}
                  <div style={{ width: 3, height: 10, borderBottom: "3px solid #e2e8f0", borderLeft: "0.5px solid #94a3b8", borderRight: "0.5px solid #94a3b8" }} />
                  {/* Right inner prong */}
                  <div style={{ width: 2.5, height: 17, borderBottom: "2px solid #cbd5e1", borderRight: "1.5px solid #cbd5e1", borderBottomRightRadius: "55%", transform: "rotate(9deg)", transformOrigin: "top center" }} />
                  {/* Right outer prong */}
                  <div style={{ width: 3, height: 22, borderBottom: "2.5px solid #94a3b8", borderRight: "2px solid #94a3b8", borderBottomRightRadius: "45%", transform: "rotate(23deg)", transformOrigin: "top center" }} />
                </div>

                {/* Prize on claw when settled */}
                {isSettled && rewardClass !== "none" && (
                  <div
                    className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-sm"
                    style={{
                      background: `radial-gradient(circle at 35% 35%, ${rc.gradTop}, ${rc.gradBot})`,
                      boxShadow: `0 0 16px ${rc.glow}, 0 2px 8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.25)`,
                      animation: "cReveal 0.45s cubic-bezier(0.34,1.56,0.64,1) forwards",
                    }}
                  >
                    {rc.emoji}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* SIDE PILLARS */}
        <div
          className="absolute"
          style={{
            left: -9, top: HH, bottom: BH, width: 9,
            background: "linear-gradient(270deg, #1a2d44, #0e1b2e)",
            borderLeft: "1px solid #2a3f58",
            borderRadius: "3px 0 0 3px",
          }}
        />
        <div
          className="absolute"
          style={{
            right: -9, top: HH, bottom: BH, width: 9,
            background: "linear-gradient(90deg, #1a2d44, #0e1b2e)",
            borderRight: "1px solid #2a3f58",
            borderRadius: "0 3px 3px 0",
          }}
        />

        {/* ── GLASS CASE ── */}
        <div
          className="relative overflow-hidden border-x-2"
          style={{
            height: GH,
            borderColor: "#1a2d44",
            background: "linear-gradient(180deg, #020c1b 0%, #040d1e 60%, #060f22 100%)",
          }}
        >
          {/* Left glass reflection */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0"
            style={{ width: 28, background: "linear-gradient(90deg, rgba(255,255,255,0.055), transparent)" }}
          />
          {/* Top glass reflection */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0"
            style={{ height: 22, background: "linear-gradient(180deg, rgba(255,255,255,0.035), transparent)" }}
          />
          {/* Diagonal glare */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.02) 0%, transparent 50%)" }}
          />

          {/* Cyan ambient glow (bottom) */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0"
            style={{ height: 40, background: "radial-gradient(ellipse at 50% 110%, rgba(6,182,212,0.1), transparent 70%)" }}
          />

          {/* Perspective grid floor */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0"
            style={{
              height: 32,
              backgroundImage:
                "linear-gradient(rgba(6,182,212,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.1) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
              maskImage: "linear-gradient(0deg, rgba(0,0,0,0.6) 0%, transparent 100%)",
            }}
          />

          {/* Scan line */}
          {(isPending || isReady) && (
            <div
              className="pointer-events-none absolute inset-x-0 h-px"
              style={{
                background: "linear-gradient(90deg, transparent 5%, rgba(6,182,212,0.8) 50%, transparent 95%)",
                animation: "cScan 2.2s linear infinite",
              }}
            />
          )}

          {/* Floating prizes */}
          {!isSettled &&
            FLOATERS.map((f, i) => (
              <div
                key={i}
                className="absolute flex items-center justify-center text-sm"
                style={{
                  width: 28, height: 28,
                  borderRadius: "50%",
                  background: `radial-gradient(circle at 35% 35%, ${f.gradTop}, ${f.gradBot})`,
                  boxShadow: `0 0 12px ${f.glow}, 0 3px 8px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.22)`,
                  top: f.top, left: f.left,
                  animation: `cPrizFloat ${f.dur} ease-in-out infinite`,
                  animationDelay: f.delay,
                  opacity: isPending ? 0.22 : 0.92,
                  transition: "opacity 0.5s ease",
                }}
              >
                {f.emoji}
              </div>
            ))}

          {/* Settled — win reveal */}
          {isSettled && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
              style={{ animation: "cReveal 0.55s cubic-bezier(0.34,1.56,0.64,1) forwards" }}
            >
              <div
                className="flex items-center justify-center rounded-2xl text-4xl"
                style={{
                  width: 72, height: 72,
                  background: `radial-gradient(circle at 35% 35%, ${rc.gradTop}, ${rc.gradBot})`,
                  boxShadow: `0 0 36px ${rc.glow}, 0 0 72px ${rc.glow}55, inset 0 2px 0 rgba(255,255,255,0.28), 0 4px 20px rgba(0,0,0,0.6)`,
                  animation:
                    rewardClass === "legendary"
                      ? "cLegendaryPulse 1.5s ease-in-out infinite"
                      : undefined,
                }}
              >
                {rc.emoji}
              </div>
              <span
                className="text-[11px] font-bold tracking-wide"
                style={{ color: rc.gradTop, textShadow: `0 0 10px ${rc.glow}` }}
              >
                {rc.label}
              </span>
            </div>
          )}
        </div>

        {/* ── BASE ── */}
        <div
          className="relative rounded-b-[20px] border-2 border-t-0"
          style={{
            height: BH,
            background: "linear-gradient(180deg, #1a2d44 0%, #0e1b2e 100%)",
            borderColor: "#2a3f58",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          }}
        >
          {/* Coin slot */}
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              top: 6, height: 6, width: 40,
              borderRadius: 999,
              background: "#020c1b",
              border: "1px solid #2a3f58",
              boxShadow: "inset 0 2px 3px rgba(0,0,0,0.8)",
            }}
          />
          {/* Control buttons */}
          <div className="absolute left-4 flex gap-2" style={{ top: 7 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "radial-gradient(circle at 35% 35%, #f87171, #7f1d1d)", boxShadow: "0 0 5px rgba(239,68,68,0.55), 0 1px 2px rgba(0,0,0,0.4)" }} />
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "radial-gradient(circle at 35% 35%, #4ade80, #14532d)", boxShadow: "0 0 5px rgba(74,222,128,0.55), 0 1px 2px rgba(0,0,0,0.4)" }} />
          </div>
          {/* Score dots */}
          <div className="absolute right-3 flex gap-1" style={{ top: 8 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: "#06b6d4", opacity: 0.45, boxShadow: "0 0 4px #06b6d4" }} />
            ))}
          </div>
        </div>

        {/* Corner bolts */}
        {([
          { left: 3, top: HH - 2 },
          { right: 3, top: HH - 2 },
          { left: 3, bottom: BH - 2 },
          { right: 3, bottom: BH - 2 },
        ] as React.CSSProperties[]).map((pos, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              ...pos,
              width: 8, height: 8,
              borderRadius: "50%",
              background: "radial-gradient(circle at 35% 35%, #5a7a9a, #1a2d44)",
              border: "1px solid #3a5270",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1)",
            }}
          />
        ))}
      </div>

      {/* State message */}
      <p
        className="mt-3 max-w-[210px] text-center text-[11px] font-medium leading-tight"
        style={{ color: isReady ? "#22d3ee" : "#64748b", textShadow: isReady ? "0 0 8px #06b6d4" : "none", transition: "color 0.4s" }}
      >
        {stateMsg}
      </p>
    </div>
  );
}
