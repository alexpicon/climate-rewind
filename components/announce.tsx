"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Say = (message: string) => void;

const AnnounceContext = createContext<Say>(() => undefined);

/** A polite live region for screen readers. Views call say() when something meaningful changes. */
export function useAnnounce(): Say {
  return useContext(AnnounceContext);
}

export function AnnounceProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const say = useCallback((next: string) => {
    clearTimeout(timer.current);
    // A short delay lets a burst of changes settle into one announcement.
    timer.current = setTimeout(() => setMessage(next), 250);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <AnnounceContext.Provider value={say}>
      {children}
      <div className="sr" id="sr-status" role="status" aria-live="polite">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}
