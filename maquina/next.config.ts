import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Baseline security headers, applied to every response. Added as
   * part of a security audit — the app previously shipped with none
   * of Next's own defaults beyond what Vercel's platform adds
   * automatically (which doesn't include these).
   *
   * Deliberately NOT included here: a Content-Security-Policy. Getting
   * one right needs a real click-through of the deployed app (inline
   * styles, any third-party embeds, Next's own hydration scripts) to
   * confirm nothing breaks — that's not something this pass could
   * verify without live-testing production, so it's flagged as a
   * follow-up instead of shipped half-verified.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Nothing in this app is meant to be framed by another site —
          // an admin/finance page rendered inside an attacker's iframe
          // is a clickjacking setup. DENY, not SAMEORIGIN: there's no
          // legitimate same-origin framing use case either.
          { key: "X-Frame-Options", value: "DENY" },
          // Stops browsers from guessing a response's content type from
          // its body instead of trusting the declared Content-Type —
          // relevant here since the app serves user-uploaded W-9 PDFs.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Send the full referrer on same-origin navigation (fine,
          // stays internal) but only the origin — not the full path or
          // query string — cross-origin. Matters because auth/recovery
          // links carry one-time codes in the URL; this keeps those out
          // of any third-party Referer header.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // This app doesn't use any of these browser capabilities —
          // deny them outright rather than leaving them ambient.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
