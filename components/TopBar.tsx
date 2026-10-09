"use client";

import type { FormEvent, ReactNode } from "react";
import { APP_NAME } from "@/lib/brand";
import { VISIBLE_TABS, TAB_LABEL, TAB_SHORT, viewUrl, type Tab } from "@/lib/ui/tabs";

const TAB_ICON: Record<Tab, ReactNode> = {
  ahead: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </>
  ),
  story: (
    <>
      <path d="M4 19V5" />
      <path d="M4 12h5l2-5 3 10 2-5h4" />
    </>
  ),
  storm: <path d="M12 3c3.5 4.5 6 7.5 6 10.5a6 6 0 0 1-12 0C6 10.5 8.5 7.5 12 3z" />,
  heat: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2L19 19M19 5l-1.8 1.8M6.8 17.2L5 19" />
    </>
  ),
  tornado: <path d="M3 5h18M5 9h14M8 13h9M10 17h5M12 21h1" />,
  future: (
    <>
      <path d="M3 17l5-5 4 4 8-9" />
      <path d="M15 7h5v5" />
    </>
  ),
  ready: (
    <>
      <path d="M12 3l8 3v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  how: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5v.1" />
    </>
  ),
};

interface Props {
  input: string;
  onInput: (value: string) => void;
  onSubmit: () => void;
  matched: string | null;
  lookingUp: boolean;
  tab: Tab;
  address: string | null;
  onTab: (tab: Tab) => void;
  live: ReactNode;
}

/** Logo, address search, live alerts strip and the four tabs. No wrapping, no overlap from 1280 px up. */
export function TopBar({ input, onInput, onSubmit, matched, lookingUp, tab, address, onTab, live }: Props) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <header id="bar">
      <a className="brand" href="/" aria-label={`${APP_NAME}, home`}>
        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
          <path d="M15 2.5c4.6 6 8.2 10 8.2 14.4A8.2 8.2 0 0 1 6.8 16.9C6.8 12.5 10.4 8.5 15 2.5Z" fill="none" stroke="#FFB45A" strokeWidth="2.2" strokeLinejoin="round" />
          <path d="M11 18.2a4.4 4.4 0 0 0 3.8 3.4" fill="none" stroke="#FFB45A" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span>{APP_NAME}</span>
      </a>

      <div id="addr">
        <form role="search" aria-label="Address" id="addrform" action="/" method="get" onSubmit={submit}>
          <svg className="pin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
            <circle cx="12" cy="9.5" r="2.5" />
          </svg>
          <label className="sr" htmlFor="addrin">
            Street address
          </label>
          <input
            id="addrin"
            name="address"
            type="text"
            value={input}
            autoComplete="street-address"
            spellCheck={false}
            placeholder="Street address, city, state"
            aria-describedby="addrmatch"
            onChange={(event) => onInput(event.target.value)}
          />
          {matched ? (
            <span className="ok" title="Matched by the US Census geocoder">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span>Census match</span>
            </span>
          ) : null}
          <input type="hidden" name="tab" value={tab} />
          <button className="go" type="submit" disabled={lookingUp}>
            {lookingUp ? "Looking…" : "Look up"}
          </button>
        </form>
        <div className="sr" id="addrmatch" role="status">
          {matched ? `Matched by the US Census geocoder: ${matched}` : "Type a US street address."}
        </div>
      </div>

      {live}

      <nav id="tabs" aria-label="Views">
        {VISIBLE_TABS.map((id) => (
          <a
            key={id}
            href={viewUrl(address, id)}
            aria-label={TAB_LABEL[id]}
            title={TAB_LABEL[id]}
            aria-current={tab === id ? "page" : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              onTab(id);
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              {TAB_ICON[id]}
            </svg>
            <span className="lbl lbl-long">{TAB_LABEL[id]}</span>
            <span className="lbl lbl-short" aria-hidden="true">
              {TAB_SHORT[id]}
            </span>
          </a>
        ))}
      </nav>
    </header>
  );
}
