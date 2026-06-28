/**
 * Shift-type colour scheme — a PURE function mapping a shift template's name to
 * a visual scheme used by the roster builder (and any other place shift types
 * are displayed). Keyword-matched, deterministic, no external calls, so it's
 * unit-testable and consistent everywhere.
 *
 * Colours mirror the design tokens in globals.css (--shift-*); they're inlined
 * here as hex so the function has no DOM/CSS dependency and can be tested.
 */

export type ShiftScheme = "morning" | "arvo" | "close" | "split" | "default";

export type ShiftColors = {
  /** Card background. */
  bg: string;
  /** Left accent bar / dot colour. */
  bar: string;
  /** Foreground text colour. */
  text: string;
};

const SCHEMES: Record<ShiftScheme, ShiftColors> = {
  morning: { bg: "#F4F8E9", bar: "#76b900", text: "#3F6212" },
  arvo: { bg: "#F2EEFB", bar: "#7C5CBF", text: "#5B21B6" },
  close: { bg: "#EEF1F5", bar: "#1E293B", text: "#1E293B" },
  split: { bg: "#FDF2E3", bar: "#D97706", text: "#92400E" },
  default: { bg: "#F0F9FF", bar: "#0EA5E9", text: "#075985" },
};

/**
 * Keyword rules, evaluated in order. The first scheme whose keywords match a
 * word in the (lower-cased) name wins. Matching is word-aware where it matters
 * (e.g. "am"/"pm" only match as standalone tokens, never inside "team").
 */
const RULES: { scheme: ShiftScheme; keywords: string[]; tokens?: string[] }[] = [
  { scheme: "split", keywords: ["split", "broken"] },
  {
    scheme: "morning",
    keywords: ["morning", "open", "early"],
    tokens: ["am"],
  },
  {
    scheme: "arvo",
    keywords: ["afternoon", "arvo", "mid"],
    tokens: ["pm"],
  },
  { scheme: "close", keywords: ["close", "closing", "late", "night"] },
];

/** Resolve a shift template name to its scheme key. */
export function shiftSchemeOf(name: string): ShiftScheme {
  const lower = (name ?? "").toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  for (const rule of RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) return rule.scheme;
    if (rule.tokens?.some((t) => words.includes(t))) return rule.scheme;
  }
  return "default";
}

/** Resolve a shift template name to its colour scheme. */
export function shiftColorScheme(name: string): ShiftColors {
  return SCHEMES[shiftSchemeOf(name)];
}
