// Extension entry point: connects the settings panel to Owlbear Rodeo.

import OBR from "@owlbear-rodeo/sdk";
import "./style.css";
import { applyToScene, layersForScope } from "./labels";
import { readAppliedRecord, writeAppliedRecord, type AppliedRecord } from "./sceneRecord";
import {
  DEFAULT_SETTINGS,
  cloneSettings,
  labelSettingsEqual,
  loadSettings,
  saveSettings,
  type Settings,
} from "./settings";
import {
  SettingsForm,
  applyTheme,
  describeResult,
  setApplyEnabled,
  setBusy,
  setSceneStatus,
  showResult,
} from "./ui";

let settings: Settings = loadSettings();
let sceneReady = false;
let applying = false;
let applied: AppliedRecord | null = null;

const form = new SettingsForm((next) => {
  settings = next;
  // Persist preferences only; the scene is untouched until "Apply".
  saveSettings(settings);
  refreshSceneStatus();
});
form.write(settings);

function refreshSceneStatus() {
  if (!OBR.isAvailable) {
    setSceneStatus("Open this page from inside Owlbear Rodeo to apply styles.");
  } else if (!sceneReady) {
    setSceneStatus("No scene is open. Open a scene to apply styles.");
  } else if (!applied) {
    setSceneStatus("These settings have not been applied to this scene yet.");
  } else if (labelSettingsEqual(applied.label, settings.label)) {
    setSceneStatus("The scene was last styled with these settings.");
  } else {
    setSceneStatus("You have changes that are not applied to the scene yet.");
  }
  if (!applying) setApplyEnabled(OBR.isAvailable && sceneReady);
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "error" in error) {
    const inner = (error as { error?: { message?: string } }).error;
    if (inner?.message) return inner.message;
  }
  return String(error);
}

async function loadAppliedRecord() {
  try {
    applied = readAppliedRecord(await OBR.scene.getMetadata());
  } catch {
    applied = null;
  }
  refreshSceneStatus();
}

async function apply() {
  if (applying) return;
  const layers = layersForScope(settings.scope);
  if (layers.length === 0) {
    showResult("error", "Choose at least one layer under “Apply to”.");
    return;
  }
  try {
    if (!(await OBR.scene.isReady())) {
      showResult("error", "No scene is open. Open a scene and try again.");
      return;
    }
  } catch (error) {
    showResult("error", `Could not reach the scene: ${errorText(error)}`);
    return;
  }

  applying = true;
  const label = { ...settings.label };
  setBusy(true, "Applying…");
  try {
    const result = await applyToScene(OBR.scene.items, layers, label, (done, total) => {
      if (total > 0) setBusy(true, `Applying… ${done}/${total}`);
    });
    const summary = describeResult(result);

    if (result.updated > 0 || result.plan.alreadyStyled.length > 0) {
      try {
        applied = await writeAppliedRecord(OBR.scene, label);
      } catch {
        // Recording is informational; the token updates already succeeded.
        summary.details.push("Note: could not record the applied style in the scene metadata.");
      }
    }
    showResult(summary.kind, summary.message, summary.details);
    const toast =
      summary.kind === "success" ? "SUCCESS" : summary.kind === "info" ? "INFO" : summary.kind === "warning" ? "WARNING" : "ERROR";
    OBR.notification.show(`Token Label Styler: ${summary.message}`, toast).catch(() => {});
  } catch (error) {
    showResult("error", `Applying the style failed: ${errorText(error)}`);
  } finally {
    applying = false;
    setBusy(false);
    refreshSceneStatus();
  }
}

function reset() {
  // Restores the form only. The scene changes only when "Apply" is clicked.
  settings = cloneSettings(DEFAULT_SETTINGS);
  saveSettings(settings);
  form.write(settings);
  refreshSceneStatus();
  showResult("info", "Settings reset to defaults. Click “Apply to All Tokens” to use them in the scene.");
}

document.getElementById("apply")!.addEventListener("click", apply);
document.getElementById("reset")!.addEventListener("click", reset);

refreshSceneStatus();

if (OBR.isAvailable) {
  OBR.onReady(async () => {
    OBR.theme.getTheme().then(applyTheme).catch(() => {});
    OBR.theme.onChange(applyTheme);

    OBR.scene.onReadyChange((ready) => {
      sceneReady = ready;
      applied = null;
      if (ready) loadAppliedRecord();
      else refreshSceneStatus();
    });
    OBR.scene.onMetadataChange((metadata) => {
      applied = readAppliedRecord(metadata);
      refreshSceneStatus();
    });

    sceneReady = await OBR.scene.isReady();
    if (sceneReady) await loadAppliedRecord();
    else refreshSceneStatus();

    if ((await OBR.player.getRole()) === "PLAYER") {
      showResult(
        "info",
        "You are a player. Tokens you are not allowed to edit will be listed as not updated.",
      );
    }
  });
}
