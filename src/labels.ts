// Scene-item discovery and native label styling.
//
// In the Owlbear Rodeo SDK a token's name label is not a separate scene item:
// it is the `text` field (a `TextContent`) of an `IMAGE` item whose
// `textItemType` is "LABEL". Styling it therefore means editing
// `item.text.style` in place, which can never create a duplicate label and
// never needs to touch the label's text (`plainText` / `richText`).

import type { Image, Item, Layer, TextStyle } from "@owlbear-rodeo/sdk";
import type { LabelSettings, ScopeSettings } from "./settings";

/** The subset of `OBR.scene.items` this module needs (injectable for tests). */
export interface ItemsApi {
  getItems(filter?: string[] | ((item: Item) => boolean)): Promise<Item[]>;
  updateItems(ids: string[], update: (drafts: Item[]) => void): Promise<void>;
}

/** The `TextStyle` fields this extension writes. All others are left alone. */
export const STYLED_KEYS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fillColor",
  "fillOpacity",
  "textAlign",
  "padding",
  "lineHeight",
] as const satisfies readonly (keyof TextStyle & keyof LabelSettings)[];

/** How many items are sent per `updateItems` call. */
export const BATCH_SIZE = 50;

export function layersForScope(scope: ScopeSettings): Layer[] {
  const layers: Layer[] = [];
  if (scope.characters) layers.push("CHARACTER");
  if (scope.mounts) layers.push("MOUNT");
  if (scope.props) layers.push("PROP");
  return layers;
}

function isImageItem(item: Item): item is Image {
  return item.type === "IMAGE";
}

function richTextHasContent(nodes: unknown): boolean {
  if (!Array.isArray(nodes)) return false;
  return nodes.some((node) => {
    if (!node || typeof node !== "object") return false;
    const { text, children } = node as { text?: unknown; children?: unknown };
    return (typeof text === "string" && text.trim().length > 0) || richTextHasContent(children);
  });
}

/** True when the label has visible text, in either plain or rich form. */
export function hasLabelText(item: Image): boolean {
  const text = item.text;
  if (!text) return false;
  if (text.type === "RICH") return richTextHasContent(text.richText);
  return (text.plainText ?? "").trim().length > 0;
}

export function styleMatches(style: Partial<TextStyle> | undefined, label: LabelSettings) {
  if (!style) return false;
  return STYLED_KEYS.every((key) => style[key] === label[key]);
}

export interface ScenePlan {
  /** Tokens whose label style differs from the settings. */
  toUpdate: Image[];
  /** Tokens already using exactly these settings (no update sent). */
  alreadyStyled: Image[];
  /** Tokens on the chosen layers whose text is a text overlay, not a label. */
  textOverlays: Image[];
  /** Tokens with malformed / missing text data that cannot be styled safely. */
  invalid: Image[];
  /** Number of tokens in `toUpdate` + `alreadyStyled` with no label text. */
  unlabeled: number;
  /** All matching token images on the chosen layers. */
  total: number;
}

/** Sorts the scene's tokens into what needs updating and what does not. */
export function planScene(
  items: Item[],
  layers: Layer[],
  label: LabelSettings,
): ScenePlan {
  const plan: ScenePlan = {
    toUpdate: [],
    alreadyStyled: [],
    textOverlays: [],
    invalid: [],
    unlabeled: 0,
    total: 0,
  };
  for (const item of items) {
    if (!isImageItem(item) || !layers.includes(item.layer)) continue;
    plan.total++;
    if (!item.text || typeof item.text !== "object" || !item.text.style) {
      plan.invalid.push(item);
      continue;
    }
    // Owlbear treats a missing textItemType as a label (the builder default).
    if (item.textItemType && item.textItemType !== "LABEL") {
      plan.textOverlays.push(item);
      continue;
    }
    if (!hasLabelText(item)) plan.unlabeled++;
    if (styleMatches(item.text.style, label)) plan.alreadyStyled.push(item);
    else plan.toUpdate.push(item);
  }
  return plan;
}

/** Writes only the styled keys onto an immer draft; text content is untouched. */
export function applyStyleToDraft(draft: Item, label: LabelSettings) {
  if (!isImageItem(draft) || !draft.text?.style) return;
  if (draft.textItemType && draft.textItemType !== "LABEL") return;
  for (const key of STYLED_KEYS) {
    (draft.text.style as unknown as Record<string, unknown>)[key] = label[key];
  }
}

export interface TokenFailure {
  id: string;
  name: string;
  reason: string;
}

export interface ApplyResult {
  plan: ScenePlan;
  updated: number;
  failures: TokenFailure[];
}

export type ProgressCallback = (done: number, total: number) => void;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "error" in error) {
    const inner = (error as { error?: { message?: unknown } }).error;
    if (inner && typeof inner.message === "string") return inner.message;
  }
  return String(error);
}

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Applies `label` to every native token label on `layers` in the current scene.
 *
 * Updates go through `OBR.scene.items.updateItems`, which only sends the
 * changed top-level fields and synchronises them to every player in the room.
 * Each batch is passed item ids rather than item objects so the SDK re-reads
 * the latest item state immediately before mutating it, minimising the chance
 * of overwriting a concurrent edit to the label text.
 *
 * After writing, the items are read back and any token whose style still does
 * not match is reported as a failure (e.g. if the player lacks permission).
 */
export async function applyToScene(
  items: ItemsApi,
  layers: Layer[],
  label: LabelSettings,
  onProgress?: ProgressCallback,
): Promise<ApplyResult> {
  const plan = planScene(await items.getItems(), layers, label);
  const failures: TokenFailure[] = plan.invalid.map((item) => ({
    id: item.id,
    name: item.name,
    reason: "Token has no label data that can be styled",
  }));

  const pending = plan.toUpdate;
  const errors = new Map<string, string>();
  let done = 0;
  onProgress?.(0, pending.length);

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const ids = batch.map((item) => item.id);
    try {
      await items.updateItems(ids, (drafts) => {
        for (const draft of drafts) applyStyleToDraft(draft, label);
      });
    } catch (batchError) {
      // Retry individually so one bad token does not fail the whole batch.
      for (const id of ids) {
        try {
          await items.updateItems([id], (drafts) => {
            for (const draft of drafts) applyStyleToDraft(draft, label);
          });
        } catch (itemError) {
          errors.set(id, errorMessage(itemError ?? batchError));
        }
      }
    }
    done += batch.length;
    onProgress?.(done, pending.length);
    await yieldToBrowser();
  }

  // Verify against the scene rather than assuming every write succeeded.
  let updated = 0;
  if (pending.length > 0) {
    const after = new Map(
      (await items.getItems(pending.map((item) => item.id))).map((item) => [item.id, item]),
    );
    for (const item of pending) {
      const current = after.get(item.id);
      if (!current) {
        failures.push({ id: item.id, name: item.name, reason: "Token was removed from the scene" });
      } else if (errors.has(item.id)) {
        failures.push({ id: item.id, name: item.name, reason: errors.get(item.id)! });
      } else if (!isImageItem(current) || !styleMatches(current.text?.style, label)) {
        failures.push({
          id: item.id,
          name: item.name,
          reason: "Style did not change (you may not have permission to edit this token)",
        });
      } else {
        updated++;
      }
    }
  }

  return { plan, updated, failures };
}
