import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountIdentity } from "@/components/AccountIdentity";

/**
 * The account-clarity block shown on onboarding and in Settings. The pages
 * pass the session email server-side; here we cover what each variant
 * renders — and that a missing email renders nothing rather than crashing
 * the page around it.
 */
describe("AccountIdentity", () => {
  it("renders the onboarding variant: lead-in, email, hint and action slot", () => {
    const html = renderToStaticMarkup(
      createElement(
        AccountIdentity,
        {
          email: "owner@example.com",
          lead: "You're signed in as",
          hint: "Setting up a new business? If you've used Roster before, you might have signed in with a different email address. Sign out and request a sign-in link using the address you used originally.",
        },
        createElement("button", null, "Sign out"),
      ),
    );
    expect(html).toContain("You&#x27;re signed in as");
    expect(html).toContain("owner@example.com");
    expect(html).toContain("signed in with a different email address");
    expect(html).toContain("Sign out");
  });

  it("renders the Settings variant: email and business name", () => {
    const html = renderToStaticMarkup(
      createElement(AccountIdentity, {
        email: "owner@example.com",
        businessName: "Brew & Bite Café",
      }),
    );
    expect(html).toContain("Signed in as");
    expect(html).toContain("owner@example.com");
    expect(html).toContain("Business:");
    expect(html).toContain("Brew &amp; Bite Café");
  });

  it("renders nothing when there is no email", () => {
    const html = renderToStaticMarkup(
      createElement(AccountIdentity, { email: null, businessName: "Café" }),
    );
    expect(html).toBe("");
  });
});
