/**
 * Deterministic avatar colours + initials for staff/people, matching the design
 * handoff's "initials on a solid circle" avatars. Pure — no state, no I/O — so
 * the same person always gets the same colour across pages (list, detail,
 * roster grid, timesheets, notices).
 *
 * The palette is the exact set of avatar colours from the design
 * (`design/handoff/README.md` → "Staff avatar colours"), all chosen for white
 * text at AA contrast.
 */

const AVATAR_COLORS = [
  "#C2683B", // terracotta (Sarah)
  "#5B6B7B", // slate (Jake)
  "#A67C00", // ochre (Marcus)
  "#8E5A9E", // plum (Aisha)
  "#2F7D6B", // teal (Tom)
  "#B5524E", // brick (Priya)
  "#6B7280", // grey (Liam)
  "#4D7C6F", // deep teal
  "#9A6A4B", // brown
  "#6D6AB0", // indigo
] as const;

/** Stable, order-independent hash of a string → non-negative int. */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Pick a deterministic avatar colour for a person. Prefer a stable id (so a
 * rename keeps the colour); fall back to the name.
 */
export function avatarColor(key: string): string {
  return (
    AVATAR_COLORS[hashString(key) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]
  );
}

/**
 * Up to two initials from a name. "Sarah Hassan" → "SH"; "Troy" → "T"; empty →
 * "?". Uppercased.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  const last = parts[parts.length - 1];
  if (parts.length === 1 || !last) return first.slice(0, 1).toUpperCase();
  return (first[0]! + last[0]!).toUpperCase();
}
