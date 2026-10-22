// A small record, kept in the shared scene metadata, of the style last applied
// with this extension. It lets the panel show whether the current settings
// differ from what the scene is using. It is informational only: the label
// styles themselves live on each token item.

import type { Metadata } from "@owlbear-rodeo/sdk";
import { normalizeSettings, type LabelSettings } from "./settings";

export const METADATA_KEY = "com.groudonmcl.token-label-styler/applied";

export interface AppliedRecord {
  label: LabelSettings;
  appliedAt: string;
}

export interface SceneMetadataApi {
  getMetadata(): Promise<Metadata>;
  setMetadata(update: Metadata): Promise<void>;
}

export function readAppliedRecord(metadata: Metadata): AppliedRecord | null {
  const raw = metadata[METADATA_KEY] as Partial<AppliedRecord> | undefined;
  if (!raw || typeof raw !== "object" || !raw.label || typeof raw.appliedAt !== "string") {
    return null;
  }
  return { label: normalizeSettings({ label: raw.label }).label, appliedAt: raw.appliedAt };
}

export async function writeAppliedRecord(scene: SceneMetadataApi, label: LabelSettings) {
  const record: AppliedRecord = { label: { ...label }, appliedAt: new Date().toISOString() };
  await scene.setMetadata({ [METADATA_KEY]: record });
  return record;
}
