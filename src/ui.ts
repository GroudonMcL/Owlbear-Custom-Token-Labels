// Settings form, live preview and result reporting. No Owlbear Rodeo API
// calls happen here; main.ts wires these pieces to the SDK.

import type { Theme } from "@owlbear-rodeo/sdk";
import {
  FONT_OPTIONS,
  LIMITS,
  normalizeSettings,
  type Settings,
} from "./settings";
import type { ApplyResult } from "./labels";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class SettingsForm {
  private form = $<HTMLFormElement>("settings-form");
  private preview = $<HTMLDivElement>("preview-label");

  constructor(private onChange: (settings: Settings) => void) {
    const fontSelect = $<HTMLSelectElement>("fontFamily");
    for (const option of FONT_OPTIONS) {
      fontSelect.add(new Option(option.label, option.value));
    }
    this.setRange("fontSize", LIMITS.fontSize);
    this.setRange("fontSize-range", LIMITS.fontSize);
    this.setRange("fillOpacity", LIMITS.fillOpacity);
    this.setRange("padding", LIMITS.padding);
    this.setRange("padding-range", LIMITS.padding);
    this.setRange("lineHeight", LIMITS.lineHeight);

    this.form.addEventListener("input", (event) => {
      const target = event.target as HTMLInputElement;
      // Keep slider / number input pairs in sync.
      const mirror = target.dataset.mirror;
      if (mirror) $<HTMLInputElement>(mirror).value = target.value;
      else this.syncMirrors();
      this.emit();
    });
    // Number inputs can be left out of range while typing; tidy on commit.
    this.form.addEventListener("change", () => this.write(this.read()));
    this.form.addEventListener("submit", (event) => event.preventDefault());
  }

  private setRange(id: string, limits: { min: number; max: number; step: number }) {
    const input = $<HTMLInputElement>(id);
    input.min = String(limits.min);
    input.max = String(limits.max);
    input.step = String(limits.step);
  }

  private syncMirrors() {
    for (const range of this.form.querySelectorAll<HTMLInputElement>("[data-mirror]")) {
      range.value = $<HTMLInputElement>(range.dataset.mirror!).value;
    }
  }

  read(): Settings {
    const data = new FormData(this.form);
    const num = (name: string) => Number(data.get(name));
    return normalizeSettings({
      label: {
        fontFamily: data.get("fontFamily"),
        fontSize: num("fontSize"),
        fontWeight: num("fontWeight"),
        fillColor: data.get("fillColor"),
        fillOpacity: num("fillOpacity"),
        textAlign: data.get("textAlign"),
        padding: num("padding"),
        lineHeight: num("lineHeight"),
      },
      scope: {
        characters: data.has("characters"),
        mounts: data.has("mounts"),
        props: data.has("props"),
      },
    });
  }

  write(settings: Settings) {
    const { label, scope } = settings;
    const el = this.form.elements;
    const set = (name: string, value: string) => {
      (el.namedItem(name) as HTMLInputElement | HTMLSelectElement).value = value;
    };
    set("fontFamily", label.fontFamily);
    set("fontSize", String(label.fontSize));
    set("fontWeight", String(label.fontWeight));
    set("fillColor", label.fillColor);
    set("fillOpacity", String(label.fillOpacity));
    set("padding", String(label.padding));
    set("lineHeight", String(label.lineHeight));
    for (const radio of this.form.querySelectorAll<HTMLInputElement>('[name="textAlign"]')) {
      radio.checked = radio.value === label.textAlign;
    }
    (el.namedItem("characters") as HTMLInputElement).checked = scope.characters;
    (el.namedItem("mounts") as HTMLInputElement).checked = scope.mounts;
    (el.namedItem("props") as HTMLInputElement).checked = scope.props;
    this.syncMirrors();
    this.render(settings);
  }

  private emit() {
    const settings = this.read();
    this.render(settings);
    this.onChange(settings);
  }

  private render({ label }: Settings) {
    $<HTMLOutputElement>("fillOpacity-out").value = `${Math.round(label.fillOpacity * 100)}%`;
    $<HTMLOutputElement>("lineHeight-out").value = label.lineHeight.toFixed(2);
    const s = this.preview.style;
    s.fontFamily = label.fontFamily;
    s.fontSize = `${label.fontSize}px`;
    s.fontWeight = String(label.fontWeight);
    const alpha = Math.round(label.fillOpacity * 255).toString(16).padStart(2, "0");
    s.color = `${label.fillColor}${alpha}`;
    s.textAlign = label.textAlign.toLowerCase();
    s.padding = `${label.padding}px`;
    s.lineHeight = String(label.lineHeight);
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement.style;
  root.setProperty("--bg", theme.background.default);
  root.setProperty("--paper", theme.background.paper);
  root.setProperty("--text", theme.text.primary);
  root.setProperty("--text-muted", theme.text.secondary);
  root.setProperty("--primary", theme.primary.main);
  root.setProperty("--primary-contrast", theme.primary.contrastText);
  document.documentElement.dataset.mode = theme.mode.toLowerCase();
}

export function setSceneStatus(text: string) {
  $<HTMLParagraphElement>("scene-status").textContent = text;
}

export function setBusy(busy: boolean, label = "Apply to All Tokens") {
  const apply = $<HTMLButtonElement>("apply");
  apply.disabled = busy;
  apply.textContent = label;
  $<HTMLButtonElement>("reset").disabled = busy;
}

export function setApplyEnabled(enabled: boolean) {
  $<HTMLButtonElement>("apply").disabled = !enabled;
}

export type ResultKind = "success" | "warning" | "error" | "info";

export function showResult(kind: ResultKind, message: string, details: string[] = []) {
  const box = $<HTMLDivElement>("result");
  box.hidden = false;
  box.className = `result ${kind}`;
  box.replaceChildren();
  const p = document.createElement("p");
  p.textContent = message;
  box.append(p);
  if (details.length > 0) {
    const list = document.createElement("ul");
    const shown = details.slice(0, 20);
    for (const line of shown) {
      const li = document.createElement("li");
      li.textContent = line;
      list.append(li);
    }
    if (details.length > shown.length) {
      const li = document.createElement("li");
      li.textContent = `…and ${details.length - shown.length} more`;
      list.append(li);
    }
    box.append(list);
  }
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Turns an apply result into an accurate, human-readable summary. */
export function describeResult(result: ApplyResult): {
  kind: ResultKind;
  message: string;
  details: string[];
} {
  const { plan, updated, failures } = result;
  if (plan.total === 0) {
    return {
      kind: "info",
      message: "No tokens were found on the selected layers in this scene.",
      details: [],
    };
  }

  const parts: string[] = [];
  if (updated > 0) parts.push(`Restyled ${plural(updated, "token")}.`);
  if (plan.alreadyStyled.length > 0) {
    parts.push(`${plural(plan.alreadyStyled.length, "token")} already had this style.`);
  }
  if (plan.unlabeled > 0) {
    parts.push(
      `${plural(plan.unlabeled, "token")} currently ${plan.unlabeled === 1 ? "has" : "have"} no label text; the style will show once ${plan.unlabeled === 1 ? "it is" : "they are"} named.`,
    );
  }
  if (plan.textOverlays.length > 0) {
    parts.push(
      `${plural(plan.textOverlays.length, "token")} skipped because ${plan.textOverlays.length === 1 ? "its text is" : "their text is"} a text overlay, not a label.`,
    );
  }

  const details = failures.map((f) => `${f.name || "Unnamed token"}: ${f.reason}`);
  if (failures.length > 0) {
    parts.unshift(`${plural(failures.length, "token")} could not be updated.`);
    return { kind: updated > 0 ? "warning" : "error", message: parts.join(" "), details };
  }
  return { kind: "success", message: parts.join(" "), details };
}
