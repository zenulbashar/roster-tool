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
  // Morning collapses to the Forest family (green stripe #2E7D4E, label #1D4A2E).
  morning: { bg: "#ECF3EE", bar: "#2E7D4E", text: "#1D4A2E" },
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
const RULES: { scheme: ShiftScheme; keywords: string[]; tokens?: string[] }[] =
  [
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

/**
 * The fixed palette an owner picks from when giving a shift type an explicit
 * colour. Each option is a hand-tuned {bg, bar, text} triple (WCAG-AA text on
 * bg), so any chosen colour stays accessible everywhere it's shown. The stored
 * value on `shift_template.color` is the `bar` hex; the picker and the resolver
 * key off it.
 */
export const SHIFT_PALETTE: (ShiftColors & { name: string })[] = [
  { name: "Green", bar: "#2E7D4E", bg: "#ECF3EE", text: "#1D4A2E" },
  { name: "Purple", bar: "#7C5CBF", bg: "#F2EEFB", text: "#5B21B6" },
  { name: "Slate", bar: "#1E293B", bg: "#EEF1F5", text: "#1E293B" },
  { name: "Amber", bar: "#D97706", bg: "#FDF2E3", text: "#92400E" },
  { name: "Sky", bar: "#0EA5E9", bg: "#F0F9FF", text: "#075985" },
  { name: "Blue", bar: "#2563EB", bg: "#EFF4FF", text: "#1E40AF" },
  { name: "Emerald", bar: "#16A34A", bg: "#ECFDF3", text: "#15803D" },
  { name: "Rose", bar: "#E11D48", bg: "#FEF1F3", text: "#9F1239" },
];

/** Accepted stored colour values (the palette bar hexes), lower-cased. */
export const SHIFT_COLOR_VALUES: string[] = SHIFT_PALETTE.map((p) => p.bar);

const PALETTE_BY_BAR = new Map(
  SHIFT_PALETTE.map((p) => [p.bar.toLowerCase(), p]),
);

/**
 * Resolve the colours to render a shift type with. An explicit, palette-valid
 * `color` (from the owner's picker) wins; otherwise we fall back to the
 * keyword-derived scheme from the name, so existing types (and any type without
 * a chosen colour) look exactly as they did before. Pure + deterministic.
 */
export function resolveShiftColors(
  color: string | null | undefined,
  label: string,
): ShiftColors {
  if (color) {
    const p = PALETTE_BY_BAR.get(color.toLowerCase());
    if (p) return { bg: p.bg, bar: p.bar, text: p.text };
  }
  return shiftColorScheme(label);
}
