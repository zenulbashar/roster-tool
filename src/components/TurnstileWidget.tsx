"use client";

import { useEffect } from "react";

/**
 * Cloudflare Turnstile widget (implicit rendering). Loads the Cloudflare script
 * once and renders the `.cf-turnstile` element; on load Cloudflare injects a
 * hidden `cf-turnstile-response` input into the surrounding <form>, which the
 * submit action reads and verifies SERVER-SIDE. If a CSP is ever added, allow
 * `https://challenges.cloudflare.com` for script-src and frame-src.
 */
export function TurnstileWidget({ siteKey }: { siteKey: string }) {
  useEffect(() => {
    if (document.querySelector("script[data-turnstile]")) return;
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.setAttribute("data-turnstile", "true");
    document.head.appendChild(script);
  }, []);

  return <div className="cf-turnstile" data-sitekey={siteKey} />;
}
