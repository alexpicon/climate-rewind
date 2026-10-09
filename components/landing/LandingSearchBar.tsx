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
      <span className="lbar-name"><BrandMark size={24} />{APP_NAME}</span>
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
        <label className="sr" htmlFor="lbar-address">
          Street address
        </label>
        <input
          id="lbar-address"
          name="address"
          type="text"
          value={input}
          autoComplete="street-address"
          spellCheck={false}
          placeholder="Type any US address"
          onChange={(event) => onInput(event.target.value)}
        />
        <button className="btn" type="submit" disabled={lookingUp}>
          {lookingUp ? "Looking up…" : "Look up"}
        </button>
      </form>
    </div>
  );
}
