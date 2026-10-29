// Regenerates all app icons (.ico, .icns, sized PNGs) from src-tauri/icons/icon.png.
// Usage: npm run icons
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "src-tauri", "icons");
const source = join(iconsDir, "icon.png");
const tauriCli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");

// `tauri icon` rewrites icon.png in the output folder, so work from a copy and put the original back.
const tmp = mkdtempSync(join(tmpdir(), "deezer-client-icons-"));
const input = join(tmp, "icon.png");
copyFileSync(source, input);
try {
  execFileSync(process.execPath, [tauriCli, "icon", input, "--output", iconsDir], { stdio: "inherit" });
  copyFileSync(input, source);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Desktop-only app: drop the mobile icon sets.
for (const dir of ["android", "ios"]) {
  rmSync(join(iconsDir, dir), { recursive: true, force: true });
}
