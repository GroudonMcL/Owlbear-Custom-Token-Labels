import { defineConfig } from "vite";

// Owlbear Rodeo loads the manifest and popover cross-origin, so the dev
// server must allow requests from the Owlbear Rodeo site.
export default defineConfig({
  server: {
    cors: { origin: "https://www.owlbear.rodeo" },
  },
  preview: {
    cors: { origin: "https://www.owlbear.rodeo" },
  },
});
