import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  loadSettings,
  normalizeSettings,
  saveSettings,
  type KeyValueStore,
} from "./settings";

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe("settings", () => {
  it("defaults to serif, 18, white, centred", () => {
    expect(DEFAULT_SETTINGS.label).toMatchObject({
      fontFamily: "serif",
      fontSize: 18,
      fillColor: "#ffffff",
      textAlign: "CENTER",
    });
  });

  it("round-trips through storage", () => {
    const store = new MemoryStore();
    const custom = normalizeSettings({ label: { fontSize: 30, padding: 0 } });
    expect(saveSettings(custom, store)).toBe(true);
    expect(loadSettings(store)).toEqual(custom);
  });

  it("falls back to defaults for missing, corrupt or out-of-range data", () => {
    const store = new MemoryStore();
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.setItem(STORAGE_KEY, "{not json");
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);

    const n = normalizeSettings({
      label: { fontSize: 9999, fontFamily: "Comic", fillColor: "red", textAlign: "UP", padding: -4 },
      scope: { props: true },
    });
    expect(n.label.fontSize).toBe(96);
    expect(n.label.fontFamily).toBe("serif");
    expect(n.label.fillColor).toBe("#ffffff");
    expect(n.label.textAlign).toBe("CENTER");
    expect(n.label.padding).toBe(0);
    expect(n.scope).toEqual({ characters: true, mounts: true, props: true });
  });

  it("reports when storage is unavailable", () => {
    const failing: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(saveSettings(DEFAULT_SETTINGS, failing)).toBe(false);
  });
});
