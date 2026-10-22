// The user's preferred label style, and how it is persisted between uses.
//
// These preferences are stored per browser in localStorage. They are only the
// user's working configuration: the scene itself is changed exclusively by
// "Apply to All Tokens" (see labels.ts), which writes to shared scene items.

export type TextAlign = "LEFT" | "CENTER" | "RIGHT";

/** Label properties that map directly onto the SDK's `TextStyle`. */
export interface LabelSettings {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fillColor: string;
  fillOpacity: number;
  textAlign: TextAlign;
  /** Space between the text and the edge of the label background. */
  padding: number;
  /** Line height multiplier; lower values reduce the vertical height. */
  lineHeight: number;
}

/** Which scene layers count as "tokens" when applying. */
export interface ScopeSettings {
  characters: boolean;
  mounts: boolean;
  props: boolean;
}

export interface Settings {
  label: LabelSettings;
  scope: ScopeSettings;
}

export interface FontOption {
  value: string;
  label: string;
}

// Owlbear Rodeo draws labels with the browser's font stack, so generic CSS
// families are the most portable choices. "Roboto" is the SDK's own default.
export const FONT_OPTIONS: FontOption[] = [
  { value: "serif", label: "Serif" },
  { value: "sans-serif", label: "Sans-serif" },
  { value: "Roboto", label: "Roboto (Owlbear default)" },
  { value: "monospace", label: "Monospace" },
  { value: "cursive", label: "Cursive" },
];

export const LIMITS = {
  fontSize: { min: 6, max: 96, step: 1 },
  fontWeight: { min: 100, max: 900, step: 100 },
  fillOpacity: { min: 0, max: 1, step: 0.05 },
  padding: { min: 0, max: 32, step: 1 },
  lineHeight: { min: 0.8, max: 2, step: 0.05 },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  label: {
    fontFamily: "serif",
    fontSize: 18,
    fontWeight: 400,
    fillColor: "#ffffff",
    fillOpacity: 1,
    textAlign: "CENTER",
    // The SDK's default image label uses padding 8 and line height 1.5, which
    // makes the background noticeably larger than the text. Tighter defaults.
    padding: 2,
    lineHeight: 1.1,
  },
  scope: {
    characters: true,
    mounts: true,
    props: false,
  },
};

export const STORAGE_KEY = "com.groudonmcl.token-label-styler/settings";

export function cloneSettings(settings: Settings): Settings {
  return {
    label: { ...settings.label },
    scope: { ...settings.scope },
  };
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * Coerces untrusted input (stored JSON, form values) into valid settings,
 * falling back to the default for any missing or invalid field.
 */
export function normalizeSettings(input: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const raw = (input && typeof input === "object" ? input : {}) as Partial<
    Record<keyof Settings, unknown>
  >;
  const label = (raw.label && typeof raw.label === "object" ? raw.label : {}) as Partial<
    Record<keyof LabelSettings, unknown>
  >;
  const scope = (raw.scope && typeof raw.scope === "object" ? raw.scope : {}) as Partial<
    Record<keyof ScopeSettings, unknown>
  >;

  const fontFamily =
    typeof label.fontFamily === "string" &&
    FONT_OPTIONS.some((f) => f.value === label.fontFamily)
      ? label.fontFamily
      : d.label.fontFamily;
  const textAlign =
    label.textAlign === "LEFT" || label.textAlign === "CENTER" || label.textAlign === "RIGHT"
      ? label.textAlign
      : d.label.textAlign;
  const fontWeight =
    Math.round(
      clamp(label.fontWeight, LIMITS.fontWeight.min, LIMITS.fontWeight.max, d.label.fontWeight) /
        100,
    ) * 100;

  return {
    label: {
      fontFamily,
      fontSize: Math.round(
        clamp(label.fontSize, LIMITS.fontSize.min, LIMITS.fontSize.max, d.label.fontSize),
      ),
      fontWeight,
      fillColor: isHexColor(label.fillColor) ? label.fillColor.toLowerCase() : d.label.fillColor,
      fillOpacity: clamp(
        label.fillOpacity,
        LIMITS.fillOpacity.min,
        LIMITS.fillOpacity.max,
        d.label.fillOpacity,
      ),
      textAlign,
      padding: Math.round(
        clamp(label.padding, LIMITS.padding.min, LIMITS.padding.max, d.label.padding),
      ),
      lineHeight: clamp(
        label.lineHeight,
        LIMITS.lineHeight.min,
        LIMITS.lineHeight.max,
        d.label.lineHeight,
      ),
    },
    scope: {
      characters: typeof scope.characters === "boolean" ? scope.characters : d.scope.characters,
      mounts: typeof scope.mounts === "boolean" ? scope.mounts : d.scope.mounts,
      props: typeof scope.props === "boolean" ? scope.props : d.scope.props,
    },
  };
}

/** Minimal storage interface so tests can supply an in-memory store. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    // Storage can be blocked (e.g. third-party iframe restrictions).
    return null;
  }
}

export function loadSettings(store: KeyValueStore | null = defaultStore()): Settings {
  if (!store) return cloneSettings(DEFAULT_SETTINGS);
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : cloneSettings(DEFAULT_SETTINGS);
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

/** Returns false if the settings could not be persisted. */
export function saveSettings(
  settings: Settings,
  store: KeyValueStore | null = defaultStore(),
): boolean {
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function labelSettingsEqual(a: LabelSettings, b: LabelSettings): boolean {
  return (Object.keys(a) as (keyof LabelSettings)[]).every((key) => a[key] === b[key]);
}
