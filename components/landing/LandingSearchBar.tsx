"use client";

import { APP_NAME } from "@/lib/brand";
import { BrandMark } from "../BrandMark";

interface Props {
  visible: boolean;
  input: string;
  onInput: (value: string) => void;
  onSubmit: () => void;
  lookingUp: boolean;
}

/** A slim bar that slides down from the top once the first screen's search has scrolled away, so an address can be typed from any section. */
export function LandingSearchBar({ visible, input, onInput, onSubmit, lookingUp }: Props) {
  return (
    <div className={visible ? "lbar on" : "lbar"} aria-hidden={visible ? undefined : true} inert={visible ? undefined : true}>
      <span className="lbar-name"><BrandMark size={24} /><span className="lbar-text">{APP_NAME}</span></span>
      <form
        className="lbar-form"
        role="search"
        aria-label="Look up an address"
        action="/"
        method="get"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <svg className="pin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
          <circle cx="12" cy="9.5" r="2.5" />
        </svg>
        <label className="sr" htmlFor="lbar-address">
          Address or city
        </label>
        <input
          id="lbar-address"
          name="address"
          type="text"
          value={input}
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
          spellCheck={false}
          placeholder="US address or city"
          onChange={(event) => onInput(event.target.value)}
        />
        <button className="go" type="submit" disabled={lookingUp}>
          {lookingUp ? "Looking up…" : "Look up"}
        </button>
      </form>
    </div>
  );
}
