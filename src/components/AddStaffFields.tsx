"use client";

import { useRef, useState } from "react";
import { nameFromEmail } from "@/lib/name-from-email";

/**
 * The name + email inputs of the "Add someone" form. As the owner types the
 * email, the full name is auto-filled from it (e.g. "john.doe@..." → "John
 * Doe") — but only until the owner edits the name themselves, so a typed name
 * is never clobbered. The inputs stay uncontrolled and submit as part of the
 * surrounding server-action <form> exactly as before.
 */
const INPUT_CLASS =
  "min-w-[150px] flex-1 rounded-[9px] border border-[var(--color-line)] px-3 py-[9px] text-[13.5px] outline-none focus:border-[var(--color-button)] focus:ring-[3px] focus:ring-[rgba(19,48,31,0.18)]";

export function AddStaffFields() {
  const nameRef = useRef<HTMLInputElement>(null);
  const [nameEdited, setNameEdited] = useState(false);

  return (
    <>
      <input
        ref={nameRef}
        name="name"
        required
        placeholder="Full name"
        aria-label="Full name"
        onChange={() => setNameEdited(true)}
        className={INPUT_CLASS}
      />
      <input
        type="email"
        name="email"
        required
        placeholder="Email address"
        aria-label="Email address"
        onChange={(e) => {
          // Auto-fill the name from the email only while the owner hasn't
          // touched the name field, so we never overwrite what they typed.
          if (nameEdited || !nameRef.current) return;
          const derived = nameFromEmail(e.target.value);
          if (derived) nameRef.current.value = derived;
        }}
        className={`${INPUT_CLASS} min-w-[170px]`}
      />
      <input
        name="role"
        maxLength={60}
        placeholder="Role (optional)"
        aria-label="Role, e.g. Barista (optional)"
        className={`${INPUT_CLASS} min-w-[130px]`}
      />
    </>
  );
}
