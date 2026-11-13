/** Horizon v2: rolling numbers, the personal sphere, group sizing and density, and reduced motion. */
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { horizonDots, MARK } from "../src/brand/horizon";
import { NARROW, stageFor, syncSteps, TIMELINE, WIDE } from "../src/v2/Explainer";
import { heroGeometry, HERO_MOTION } from "../src/v2/Hero";
import { frozenFrame, useCanvasAnimation } from "../src/v2/motion";
import { Rolling, rollPlan } from "../src/v2/Rolling";
import { assembledRadius, GROUP_SPHERE, groupSphere, personalSphere, seedUnit, sphereDots } from "../src/v2/sphere";

/** jsdom has no matchMedia: answer prefers-reduced-motion as asked. */
const media = (reduce: boolean) => {
  const fake = (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: vi.fn(fake) });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("a number rolling to its new value", () => {
  it("rolls only the digits that changed, right-aligned", () => {
    expect(rollPlan("136", "137").map((s) => s.changed)).toEqual([false, false, true]);
    expect(rollPlan("12.15", "12.15").every((s) => !s.changed)).toBe(true);
    const longer = rollPlan("9.99", "10.01");
    expect(longer.map((s) => s.to).join("")).toBe("10.01");
    expect(longer[0]).toEqual({ from: null, to: "1", changed: true });
    expect(rollPlan("1,000", "999").map((s) => s.to).join("")).toBe("999");
  });

  it("is plain text at rest, rolls on a change, then settles to plain text again", () => {
    vi.useFakeTimers();
    media(false);
    const { container, rerender } = render(<Rolling value="134" />);
    expect(container.textContent).toBe("134");
    rerender(<Rolling value="135" />);
    expect(container.querySelector("[data-rolling]")).not.toBeNull();
    expect(container.querySelectorAll(".roll-slot")).toHaveLength(1);
    expect(container.querySelector(".sr-only")!.textContent).toBe("135");
    act(() => void vi.advanceTimersByTime(2000));
    expect(container.querySelector("[data-rolling]")).toBeNull();
    expect(container.textContent).toBe("135");
  });

  it("under reduced motion just changes", () => {
    media(true);
    const { container, rerender } = render(<Rolling value="26" />);
    rerender(<Rolling value="27" />);
    expect(container.querySelector("[data-rolling]")).toBeNull();
    expect(container.textContent).toBe("27");
  });
});

describe("the personal sphere", () => {
  it("is seeded from the account name: the same name always gives the same mark", () => {
    const a = personalSphere("hyperios.testnet");
    expect(personalSphere("hyperios.testnet")).toEqual(a);
    expect(personalSphere("dana.testnet")).not.toEqual(a);
    // The reference design's seed: FNV-1a over the name, and over its parts reversed.
    expect(a.step).toBe(12 + Math.round(seedUnit("testnet.hyperios") * 3));
    expect(a.light[0]).toBeCloseTo(-0.75 + 0.45 * seedUnit("hyperios.testnet"), 10);
    expect(a.light[1]).toBeCloseTo(-0.7 + 0.3 * seedUnit("testnet.hyperios"), 10);
  });

  it("is always lit from the upper left, with 12 to 15px dot spacing", () => {
    for (const name of ["a.testnet", "lp-north.wardline-labs.testnet", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "x"]) {
      const s = personalSphere(name);
      expect(s.step).toBeGreaterThanOrEqual(12);
      expect(s.step).toBeLessThanOrEqual(15);
      expect(s.light[0]).toBeLessThan(0);
      expect(s.light[1]).toBeLessThan(0);
    }
  });
});

describe("group spheres", () => {
  it("grow with proven calls, by the square root, from 52px to 150px", () => {
    expect(groupSphere(0, 55, "bronze").R).toBe(52);
    expect(groupSphere(55, 55, "gold").R).toBe(150);
    expect(groupSphere(46, 46, "gold").R).toBe(150);
    // The reference's numbers: 16 of 46 proven calls.
    expect(groupSphere(16, 46, "silver").R).toBe(Math.round(52 + 98 * Math.sqrt(16 / 46)));
    expect(groupSphere(20, 55, "silver").R).toBeLessThan(groupSphere(55, 55, "silver").R);
    expect(groupSphere(10, 0, "bronze").R).toBe(52);
    expect(groupSphere(55, 55, "gold", GROUP_SPHERE.phoneScale).R).toBe(Math.round(150 * GROUP_SPHERE.phoneScale));
  });

  it("get denser and brighter with a better tier", () => {
    const [g, s, b] = (["gold", "silver", "bronze"] as const).map((t) => groupSphere(30, 55, t));
    expect([g!.step, s!.step, b!.step]).toEqual([9, 12, 16]);
    expect(g!.floor).toBeGreaterThan(s!.floor);
    expect(s!.floor).toBeGreaterThan(b!.floor);
    const count = (t: "gold" | "silver" | "bronze") => {
      const x = groupSphere(30, 55, t);
      return sphereDots({ cx: 0, cy: 0, R: x.R, step: x.step, light: [-0.55, -0.6], floor: x.floor, gap: x.gap }).length;
    };
    expect(count("gold")).toBeGreaterThan(count("silver"));
    expect(count("silver")).toBeGreaterThan(count("bronze"));
    expect(b!.gap).toBe(Math.max(6, 16 * 0.8));
  });
});

describe("the v2 sphere from horizonDots", () => {
  it("leaves the classic mark unchanged", () => {
    const classic = horizonDots(MARK);
    expect(classic.length).toBeGreaterThan(150);
    // Classic rows are offset by half a step; the v2 grid is square.
    expect(new Set(classic.map((d) => (d.x - MARK.cx + MARK.R) % MARK.step)).size).toBeGreaterThan(1);
    expect(classic.every((d) => d.r >= 0.4)).toBe(true);
  });

  it("puts white dots above the -10 degree line and violet below, with a clean gap", () => {
    const dots = sphereDots({ cx: 0, cy: 0, R: 100, step: 10, light: [-0.55, -0.6], floor: 0.2, gap: 12 });
    expect(dots.every((d) => (d.off < 0 ? d.fill === "#F5F3F7" : d.fill === "#7B6CFF"))).toBe(true);
    expect(dots.every((d) => Math.abs(d.off) >= 6)).toBe(true);
    // Lit from the upper left: a dot there is bigger than its mirror at the lower right.
    const at = (x: number, y: number) => dots.find((d) => d.x === x && d.y === y)!;
    expect(at(-50, -50).r).toBeGreaterThan(at(50, 50).r);
  });

  it("assembles outward from the line", () => {
    const [d] = sphereDots({ cx: 0, cy: 0, R: 100, step: 10, light: [-0.55, -0.6], floor: 0.2, gap: 12 }).filter((x) => Math.abs(x.off) > 80);
    expect(assembledRadius(d!, 100, 0)).toBe(0);
    expect(assembledRadius(d!, 100, 0.3)).toBe(0);
    expect(assembledRadius(d!, 100, 1)).toBeCloseTo(d!.r, 10);
  });
});

function Probe({ draw, duration, freezeAt = null }: { draw: (t: number) => void; duration: number; freezeAt?: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useCanvasAnimation(ref, draw, { duration, freezeAt, finalAt: duration === Infinity ? 2.4 : undefined });
  return <div ref={ref} />;
}

describe("reduced motion", () => {
  it("draws only the final frame, once, and never schedules another", () => {
    media(true);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const draw = vi.fn();
    const { container } = render(<Probe draw={draw} duration={TIMELINE.end} />);
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenLastCalledWith(TIMELINE.end);
    expect(raf).not.toHaveBeenCalled();
    expect(container.firstElementChild!.getAttribute("data-motion")).toBe("still");
  });

  it("the hero's final frame is the built sphere under its resting light, with no drift", () => {
    media(true);
    const draw = vi.fn();
    render(<Probe draw={draw} duration={Infinity} />);
    expect(draw).toHaveBeenCalledWith(HERO_MOTION.drift.start);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("with motion on, starts from the first frame", () => {
    media(false);
    const draw = vi.fn();
    render(<Probe draw={draw} duration={3} />);
    expect(draw).toHaveBeenCalledWith(0);
  });

  it("?frame=name:seconds holds one animation at that second", () => {
    expect(frozenFrame("explainer", "?frame=explainer:4.5")).toBe(4.5);
    expect(frozenFrame("hero", "?frame=explainer:4.5")).toBeNull();
    media(false);
    const draw = vi.fn();
    render(<Probe draw={draw} duration={10} freezeAt={6.8} />);
    expect(draw).toHaveBeenCalledWith(6.8);
  });
});

describe("layouts", () => {
  it("the explainer uses the wide diagram from a 560px canvas and the phone diagram below", () => {
    expect(stageFor(640)).toEqual({ layout: WIDE, scale: 1 });
    expect(stageFor(560).scale).toBeCloseTo(560 / 640, 10);
    expect(stageFor(560).layout).toBe(WIDE);
    expect(stageFor(390)).toEqual({ layout: NARROW, scale: 1 });
    expect(stageFor(559).layout).toBe(NARROW);
  });

  it("the explainer's words switch on with the story's clock", () => {
    const el = document.createElement("div");
    syncSteps(el, 0);
    expect(el.className).toBe("");
    syncSteps(el, TIMELINE.checks[1]! + 0.01);
    expect(el.classList.contains("on-s1") && el.classList.contains("on-c1") && el.classList.contains("on-c2")).toBe(true);
    expect(el.classList.contains("on-c3") || el.classList.contains("on-s2")).toBe(false);
    syncSteps(el, TIMELINE.final);
    for (const k of ["s1", "c1", "c2", "c3", "r1", "s2", "f2", "r2", "fin"]) expect(el.classList.contains(`on-${k}`)).toBe(true);
  });

  it("the hero's sphere sits right of the copy on wide screens and above it on phones", () => {
    const wide = heroGeometry(1440);
    expect(wide.phone).toBe(false);
    expect(wide.cx - wide.R).toBeGreaterThan(640);
    const phone = heroGeometry(390);
    expect(phone.phone).toBe(true);
    expect(phone.cx - phone.R).toBeGreaterThanOrEqual(20);
    expect(phone.cx + phone.R).toBeLessThanOrEqual(370);
  });
});

describe("staying connected", () => {
  it("keeps a NEAR Connect wallet across tabs, restores it with no reconnect, and Disconnect clears it", async () => {
    const { setConnected, currentConnected } = await import("../src/wallets/connected");
    const { restoreNearConnection, setConnectorFactory } = await import("../src/wallets/near");
    setConnected({ account: "hyperios.testnet", wallet: "near-connect", via: "meteor-wallet" });
    expect(JSON.parse(localStorage.getItem("wardline.connected")!)).toMatchObject({ account: "hyperios.testnet" });
    expect(sessionStorage.getItem("wardline.connected")).toBeNull();

    // A new tab: NEAR Connect remembers the wallet, which still has the account.
    localStorage.setItem("selected-wallet", "meteor-wallet");
    const connect = vi.fn();
    setConnectorFactory(() => ({ connect, disconnect: async () => undefined, wallet: async () => ({ getAccounts: async () => [{ accountId: "hyperios.testnet" }], manifest: { id: "meteor-wallet" } }) as never }));
    await restoreNearConnection();
    expect(currentConnected()).toMatchObject({ account: "hyperios.testnet", wallet: "near-connect" });
    expect(connect).not.toHaveBeenCalled();

    // The wallet forgot the account: the remembered connection is cleared.
    setConnectorFactory(() => ({ connect, disconnect: async () => undefined, wallet: async () => Promise.reject(new Error("no wallet")) }));
    await restoreNearConnection();
    expect(currentConnected()).toBeNull();
    expect(localStorage.getItem("wardline.connected")).toBeNull();

    // A typed-account wallet stays in this tab only.
    setConnected({ account: "dana.testnet", wallet: "local-signer" });
    expect(sessionStorage.getItem("wardline.connected")).not.toBeNull();
    expect(localStorage.getItem("wardline.connected")).toBeNull();
    setConnected(null);
    expect(sessionStorage.getItem("wardline.connected")).toBeNull();
    setConnectorFactory(null);
    localStorage.removeItem("selected-wallet");
  });
});

describe("product polish", () => {
  it("#/how-it-works and #/demo land on About's steps, and #/me on the Balance page", async () => {
    const { parseRoute, redirected } = await import("../src/router");
    expect(redirected("#/how-it-works")).toBe("#/about/steps");
    expect(redirected("#/demo")).toBe("#/about/steps");
    expect(parseRoute(redirected("#/demo"))).toEqual({ kind: "site", page: "about", section: "steps" });
    expect(redirected("#/me")).toBe("#/wallet");
    expect(parseRoute(redirected("#/me"))).toEqual({ kind: "site", page: "wallet" });
  });

  it("proof amounts: two decimals, <0.01 for a fraction of a cent, 0.00 when nothing moved", async () => {
    const { proofAmount } = await import("../src/views/site/Proof");
    expect(proofAmount("0")).toBe("0.00");
    expect(proofAmount("200")).toBe("<0.01");
    expect(proofAmount("9999")).toBe("<0.01");
    expect(proofAmount("10000")).toBe("0.01");
    expect(proofAmount("1234567")).toBe("1.23");
  });

  it("back-to-back proofs from one group with one outcome collapse into one row with a count", async () => {
    const { collapseProofs } = await import("../src/views/site/Proof");
    const row = (id: string, group: string, side: "above" | "below", amount = "200", refund = "0") => ({ call_id: id, group, side, amount, refund }) as never;
    const key = (p: { group: string; side: string }) => `${p.group}|${p.side}`;
    const out = collapseProofs([row("a", "Mission", "below"), row("b", "Mission", "below"), row("c", "Mission", "below"), row("d", "Kelp", "above"), row("e", "Mission", "below")], key);
    expect(out.map((g) => [g.row.call_id, g.count])).toEqual([["a", 3], ["d", 1], ["e", 1]]);
    expect(out[1]!.total).toBe("200");
  });

  it("the explainer has no replay", async () => {
    media(true);
    const { Explainer } = await import("../src/v2/Explainer");
    const { container } = render(<Explainer />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/replay|practice/i);
  });
});
