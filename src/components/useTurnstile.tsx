"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme?: "dark" | "light" | "auto";
      language?: string;
      appearance?: "always" | "execute" | "interaction-only";
      "refresh-expired"?: "auto" | "manual" | "never";
    }
  ) => string;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// Cloudflare Turnstile in "managed" mode: invisible for normal visitors, a
// short check appears only when Cloudflare is unsure. Supabase Auth
// verifies the token (CAPTCHA protection), so the secret key never reaches
// this app. Without a site key everything is a no-op.
export function useTurnstile(siteKey?: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const waiters = useRef<((token: string | null) => void)[]>([]);
  const [scriptReady, setScriptReady] = useState(false);

  const setToken = useCallback((token: string | null) => {
    tokenRef.current = token;

    if (token) {
      for (const resolve of waiters.current.splice(0)) resolve(token);
    }
  }, []);

  useEffect(() => {
    if (!siteKey || !scriptReady || !containerRef.current || widgetId.current) {
      return;
    }

    widgetId.current =
      window.turnstile?.render(containerRef.current, {
        sitekey: siteKey,
        theme: "dark",
        language: "az",
        appearance: "interaction-only",
        "refresh-expired": "auto",
        callback: (token) => setToken(token),
        "expired-callback": () => setToken(null),
        "error-callback": () => setToken(null),
      }) ?? null;
  }, [siteKey, scriptReady, setToken]);

  // Resolves with a token (waits up to 15 s while the invisible check
  // finishes), or null when CAPTCHA is not configured or did not pass.
  const getToken = useCallback(async (): Promise<string | null | undefined> => {
    if (!siteKey) {
      return undefined;
    }

    if (tokenRef.current) {
      return tokenRef.current;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiters.current = waiters.current.filter((w) => w !== done);
        resolve(null);
      }, 15000);
      const done = (token: string | null) => {
        clearTimeout(timer);
        resolve(token);
      };
      waiters.current.push(done);
    });
  }, [siteKey]);

  // A token is single-use: get a fresh one after every attempt.
  const reset = useCallback(() => {
    if (!siteKey) {
      return;
    }

    tokenRef.current = null;
    window.turnstile?.reset(widgetId.current ?? undefined);
  }, [siteKey]);

  const widget = siteKey ? (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div ref={containerRef} />
    </>
  ) : null;

  return { widget, getToken, reset };
}
