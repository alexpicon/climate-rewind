import { describe, expect, it } from "vitest";
import { HISTORY_LABEL, HISTORY_VIEWS, parseTab, TOP_LABEL, TOP_SHORT, TOP_TAB_VIEW, TOP_TABS, topTabOf, VISIBLE_TOP_TABS, viewUrl } from "@/lib/ui/tabs";

describe("the phone tab bar (WCAG 2.5.3, label in name)", () => {
  it("each short label is made of whole words of the link's accessible name (axe flagged 'Tornado' against 'Tornadoes')", () => {
    for (const tab of TOP_TABS) {
      const name = TOP_LABEL[tab].toLowerCase().split(/\s+/);
      // "72 hours" is in "Next 72 hours"; "History" is in "Your history"; "Changing" is the one short word the bar changes (checked below).
      for (const word of TOP_SHORT[tab].toLowerCase().split(/\s+/)) {
        if (tab === "future") continue;
        expect(name, `${tab}: ${word}`).toContain(word);
      }
    }
    expect(TOP_SHORT.future).toBe("Changing");
    expect(TOP_LABEL.future).toBe("What’s changing");
  });
});

describe("four top tabs", () => {
  it("are Next 72 hours, Your history, What's changing and Get ready; How it works is not one of them", () => {
    expect(TOP_TABS).toEqual(["ahead", "history", "future", "ready"]);
    expect(VISIBLE_TOP_TABS).toEqual(["ahead", "history", "future", "ready"]);
    expect(TOP_TABS.map((tab) => TOP_LABEL[tab])).toEqual(["Next 72 hours", "Your history", "What’s changing", "Get ready"]);
    expect(topTabOf("how")).toBeNull();
  });

  it("keeps the four history views behind one tab, story first", () => {
    expect(HISTORY_VIEWS).toEqual(["story", "storm", "heat", "tornado"]);
    expect(HISTORY_VIEWS.map((view) => HISTORY_LABEL[view])).toEqual(["Story", "Storm replay", "Heat wave", "Tornadoes"]);
    for (const view of HISTORY_VIEWS) expect(topTabOf(view)).toBe("history");
    expect(TOP_TAB_VIEW.history).toBe("story");
  });

  it("keeps every old link working: ?tab=storm, heat, tornado and story are history views, and ?tab=history opens the story", () => {
    expect(parseTab("storm")).toBe("storm");
    expect(parseTab("heat")).toBe("heat");
    expect(parseTab("tornado")).toBe("tornado");
    expect(parseTab("story")).toBe("story");
    expect(parseTab("history")).toBe("story");
    expect(parseTab("future")).toBe("future");
    expect(parseTab("ready")).toBe("ready");
    expect(parseTab("how")).toBe("how");
    expect(topTabOf(parseTab("storm"))).toBe("history");
    expect(viewUrl("1 Main St", TOP_TAB_VIEW.history)).toBe("/?address=1+Main+St&tab=story");
  });
});
