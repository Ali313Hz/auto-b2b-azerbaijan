import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Per-request nonce CSP (see node_modules/next/dist/docs/01-app/02-guides/
// content-security-policy.md). Next.js adds the nonce to its own scripts.
function contentSecurityPolicy(nonce: string) {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const turnstile = "https://challenges.cloudflare.com";
  const isDev = process.env.NODE_ENV === "development";

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${turnstile}${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind is a static file; 'unsafe-inline' only covers style
    // attributes injected by Next.js and the Turnstile widget.
    "style-src 'self' 'unsafe-inline'",
    // Signed Supabase Storage URLs; data: for the MFA QR code.
    `img-src 'self' blob: data: ${supabase}`,
    `media-src 'self' ${supabase}`,
    "font-src 'self'",
    // Browser-side Supabase Auth (login/MFA) and video uploads.
    `connect-src 'self' ${supabase}`,
    `frame-src ${turnstile}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
