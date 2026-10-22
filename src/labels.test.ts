import { describe, expect, it } from "vitest";
import type { Image, Item } from "@owlbear-rodeo/sdk";
import {
  BATCH_SIZE,
  applyToScene,
  hasLabelText,
  layersForScope,
  planScene,
  type ItemsApi,
} from "./labels";
import { DEFAULT_SETTINGS } from "./settings";
import { describeResult } from "./ui";

const label = DEFAULT_SETTINGS.label;

function token(id: string, overrides: Partial<Image> = {}, text = "Goblin Warrior"): Image {
  return {
    id,
    type: "IMAGE",
    name: `Token ${id}`,
    visible: true,
    locked: false,
    createdUserId: "user",
    zIndex: 1,
    lastModified: "2024-01-01",
    lastModifiedUserId: "user",
    position: { x: 10, y: 20 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    metadata: { "other.extension/hp": 12 },
    layer: "CHARACTER",
    image: { url: "https://example.com/a.png", mime: "image/png", width: 300, height: 300 },
    grid: { dpi: 300, offset: { x: 150, y: 150 } },
    textItemType: "LABEL",
    text: {
      type: "PLAIN",
      plainText: text,
      richText: [{ type: "paragraph", children: [{ text }] }],
      width: "AUTO",
      height: "AUTO",
      style: {
        padding: 8,
        fontFamily: "Roboto",
        fontSize: 24,
        fontWeight: 400,
        textAlign: "CENTER",
        textAlignVertical: "BOTTOM",
        fillColor: "white",
        fillOpacity: 1,
        strokeColor: "black",
        strokeOpacity: 1,
        strokeWidth: 2,
        lineHeight: 1.5,
      },
    },
    ...overrides,
  };
}

/** In-memory scene that mimics updateItems: mutate a copy, then commit. */
class FakeScene implements ItemsApi {
  items: Item[];
  updateCalls: string[][] = [];
  failIds = new Set<string>();
  ignoreIds = new Set<string>();

  constructor(items: Item[]) {
    this.items = structuredClone(items);
  }

  async getItems(filter?: string[] | ((item: Item) => boolean)) {
    const all = structuredClone(this.items);
    if (Array.isArray(filter)) return all.filter((i) => filter.includes(i.id));
    return filter ? all.filter(filter) : all;
  }

  async updateItems(ids: string[], update: (drafts: Item[]) => void) {
    this.updateCalls.push(ids);
    if (ids.some((id) => this.failIds.has(id))) throw new Error("Permission denied");
    const drafts = await this.getItems(ids);
    update(drafts);
    for (const draft of drafts) {
      if (this.ignoreIds.has(draft.id)) continue;
      const index = this.items.findIndex((i) => i.id === draft.id);
      this.items[index] = draft;
    }
  }
}

describe("planScene", () => {
  it("sorts tokens by what needs doing", () => {
    const styled = token("styled");
    styled.text.style = { ...styled.text.style, ...label };
    const items: Item[] = [
      token("a"),
      styled,
      token("overlay", { textItemType: "TEXT" }),
      token("prop", { layer: "PROP" }),
      token("blank", {}, ""),
      { ...token("shape"), type: "SHAPE" } as Item,
    ];
    const plan = planScene(items, ["CHARACTER"], label);
    expect(plan.toUpdate.map((i) => i.id)).toEqual(["a", "blank"]);
    expect(plan.alreadyStyled.map((i) => i.id)).toEqual(["styled"]);
    expect(plan.textOverlays.map((i) => i.id)).toEqual(["overlay"]);
    expect(plan.unlabeled).toBe(1);
    expect(plan.total).toBe(4);
  });

  it("respects the layer scope", () => {
    expect(layersForScope({ characters: true, mounts: false, props: true })).toEqual([
      "CHARACTER",
      "PROP",
    ]);
  });
});

describe("hasLabelText", () => {
  it("handles rich text", () => {
    const rich = token("r");
    rich.text.type = "RICH";
    rich.text.richText = [{ type: "paragraph", children: [{ text: "" }] }];
    expect(hasLabelText(rich)).toBe(false);
    rich.text.richText = [{ type: "paragraph", children: [{ text: "Orc", bold: true }] }];
    expect(hasLabelText(rich)).toBe(true);
  });
});

describe("applyToScene", () => {
  it("restyles labels without touching text or unrelated properties", async () => {
    const original = token("a");
    const scene = new FakeScene([original]);
    const result = await applyToScene(scene, ["CHARACTER"], label);

    expect(result.updated).toBe(1);
    expect(result.failures).toEqual([]);
    const after = scene.items[0] as Image;
    expect(after.text.plainText).toBe("Goblin Warrior");
    expect(after.text.richText).toEqual(original.text.richText);
    expect(after.text.style).toEqual({
      ...original.text.style,
      fontFamily: "serif",
      fontSize: 18,
      fillColor: "#ffffff",
      textAlign: "CENTER",
      padding: label.padding,
      lineHeight: label.lineHeight,
    });
    // Unrelated fields, including the outline and other extensions' data.
    const { text: _a, ...restAfter } = after;
    const { text: _b, ...restBefore } = original;
    expect(restAfter).toEqual(restBefore);
  });

  it("creates no items and is idempotent", async () => {
    const scene = new FakeScene([token("a"), token("b")]);
    await applyToScene(scene, ["CHARACTER"], label);
    const calls = scene.updateCalls.length;
    const again = await applyToScene(scene, ["CHARACTER"], label);
    expect(scene.items).toHaveLength(2);
    expect(scene.updateCalls.length).toBe(calls);
    expect(again.updated).toBe(0);
    expect(again.plan.alreadyStyled).toHaveLength(2);
  });

  it("batches large scenes", async () => {
    const tokens = Array.from({ length: BATCH_SIZE * 2 + 5 }, (_, i) => token(`t${i}`));
    const scene = new FakeScene(tokens);
    const progress: number[] = [];
    const result = await applyToScene(scene, ["CHARACTER"], label, (done) => progress.push(done));
    expect(result.updated).toBe(tokens.length);
    expect(scene.updateCalls.map((c) => c.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 5]);
    expect(progress.at(-1)).toBe(tokens.length);
  });

  it("reports individual failures without blocking the rest", async () => {
    const scene = new FakeScene([token("ok"), token("denied"), token("ignored")]);
    scene.failIds.add("denied");
    scene.ignoreIds.add("ignored");
    const result = await applyToScene(scene, ["CHARACTER"], label);
    expect(result.updated).toBe(1);
    expect(result.failures.map((f) => [f.id, f.reason])).toEqual([
      ["denied", "Permission denied"],
      ["ignored", expect.stringContaining("permission")],
    ]);
    const summary = describeResult(result);
    expect(summary.kind).toBe("warning");
    expect(summary.message).toContain("2 tokens could not be updated");
  });

  it("reports tokens with malformed label data", async () => {
    const broken = token("broken");
    (broken as { text?: unknown }).text = undefined;
    const scene = new FakeScene([broken]);
    const result = await applyToScene(scene, ["CHARACTER"], label);
    expect(result.failures).toHaveLength(1);
    expect(describeResult(result).kind).toBe("error");
  });
});
