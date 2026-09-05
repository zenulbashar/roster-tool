"use client";

/**
 * Last-resort boundary (PERF-09): catches an error thrown by the ROOT layout
 * itself, where no other boundary can. It must render its own <html> and
 * <body>, and it cannot rely on globals.css having loaded — so everything is
 * inline and self-contained. The server has already logged the failure (and
 * forwarded it, when configured) via src/instrumentation.ts with this same
 * digest, which the page shows as the reference code.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 20px",
          fontFamily:
            "'Public Sans', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "radial-gradient(circle at 50% 0, #ECF3EE, #F9FAFB 60%)",
          color: "#111827",
        }}
      >
        <div
          role="alert"
          style={{
            width: "100%",
            maxWidth: 560,
            background: "#fff",
            border: "1px solid #E5E7EB",
            borderRadius: 18,
            padding: 30,
            boxShadow: "0 8px 30px rgba(17,24,39,0.07)",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.01em",
            }}
          >
            Roster hit a problem
          </h1>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 14,
              lineHeight: 1.55,
              color: "#4B5563",
            }}
          >
            This has been recorded and we&rsquo;ll look into it. Try again, or
            come back in a moment — nothing you&rsquo;d already saved is lost.
          </p>
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "#6B7280" }}>
            Reference code:{" "}
            <code
              style={{
                border: "1px solid #E5E7EB",
                background: "#F9FAFB",
                borderRadius: 6,
                padding: "2px 7px",
                fontSize: 12.5,
                color: "#111827",
              }}
            >
              {error.digest || "not available"}
            </code>
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: 44,
                border: 0,
                borderRadius: 11,
                background: "#13301F",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13.5,
                padding: "11px 17px",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* A full document navigation is deliberate here: the root layout
                itself failed, so a client-side <Link> transition would land in
                the same broken tree. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                minHeight: 44,
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 11,
                border: "1px solid #D1D5DB",
                background: "#fff",
                color: "#374151",
                fontWeight: 600,
                fontSize: 13.5,
                padding: "10px 16px",
                textDecoration: "none",
              }}
            >
              Go to the home page
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
