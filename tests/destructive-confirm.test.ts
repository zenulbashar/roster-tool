import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * UX-04 guard: every `delete*` server action in the owner area goes through
 * the two-step confirmation — the first submit bounces to a server-rendered
 * ConfirmDeleteCard and only a submit carrying `confirmed=1` removes anything.
 * A new delete action that never reads `confirmed` fails this test, so the
 * confirm pattern can't quietly stay per-feature again.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const ACTION =
  /(?:export\s+)?async function (delete\w*)\(formData: FormData\)/g;

describe("destructive server actions", () => {
  const root = join(process.cwd(), "src", "app");
  const found: { file: string; name: string; confirms: boolean }[] = [];

  for (const file of walk(root)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(ACTION)) {
      const start = m.index ?? 0;
      // The body runs until the next function declaration in the file.
      const rest = text.slice(start + m[0].length);
      const next = rest.search(/\n\s*(?:export\s+)?(?:async )?function /);
      const body = next >= 0 ? rest.slice(0, next) : rest;
      found.push({
        file: relative(process.cwd(), file),
        name: m[1]!,
        confirms: /formData\.get\("confirmed"\)/.test(body),
      });
    }
  }

  it("finds the delete actions (sanity check on the scan)", () => {
    const names = found.map((f) => f.name).sort();
    for (const expected of [
      "deleteCert",
      "deleteDocumentAction",
      "deleteEntry",
      "deleteForm",
      "deleteItem",
      "deleteLeave",
      "deletePayRuleAction",
      "deleteStaff",
      "deleteSupplier",
      "deleteTemplate",
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  it("every delete action reads the `confirmed` field before acting", () => {
    const unconfirmed = found
      .filter((f) => !f.confirms)
      .map((f) => `${f.file}: ${f.name}`);
    expect(unconfirmed).toEqual([]);
  });
});
