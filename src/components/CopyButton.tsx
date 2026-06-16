"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

/** Copy a value to the clipboard with brief "Copied" feedback. */
export function CopyButton({
  value,
  label = "Copy link",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable (insecure context); the URL is shown
      // alongside for manual copy, so we just no-op.
    }
  }

  return (
    <Button type="button" variant="secondary" onClick={copy}>
      {copied ? "Copied!" : label}
    </Button>
  );
}
