"use client";

import { useEffect, useState } from "react";

/**
 * The screen's pixel ratio for canvas backing stores, at most 2. It is 1 on the server and on the first render, and the real value
 * after mount: a canvas size worked out from `window` during render would differ from the server's HTML, and React keeps the server's
 * attribute when hydrating, leaving a canvas stretched on high-density screens.
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(1);
  useEffect(() => {
    setDpr(Math.min(2, window.devicePixelRatio || 1));
  }, []);
  return dpr;
}
