import { describe, expect, it } from "vitest";
import { TAB_LABEL, TAB_SHORT, TABS } from "@/lib/ui/tabs";

describe("the phone tab bar (WCAG 2.5.3, label in name)", () => {
  it("each short label is made of whole words of the link's accessible name (axe flagged 'Tornado' against 'Tornadoes')", () => {
    for (const tab of TABS) {
      const name = TAB_LABEL[tab].toLowerCase().split(/\s+/);
      for (const word of TAB_SHORT[tab].toLowerCase().split(/\s+/)) expect(name, `${tab}: ${word}`).toContain(word);
    }
  });
});
