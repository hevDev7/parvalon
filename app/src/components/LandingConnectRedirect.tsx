"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";

/**
 * On the landing page, send the user straight into /claim the moment they
 * connect a wallet. Watches the `connecting → connected` edge specifically, so
 * an automatic reconnect (`reconnecting → connected`) or an already-connected
 * visit does not bounce the user off the landing page.
 */
export function LandingConnectRedirect() {
  const { status } = useAccount();
  const router = useRouter();
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (prev.current === "connecting" && status === "connected") {
      router.push("/claim");
    }
    prev.current = status;
  }, [status, router]);

  return null;
}
