import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as {
  version: string;
};

function resolveCommitHash() {
  const ciCommit =
    process.env.GIT_COMMIT ?? process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA;
  if (typeof ciCommit === "string" && ciCommit.trim().length > 0) {
    return ciCommit.trim().slice(0, 12);
  }
  try {
    return execSync("git rev-parse --short=12 HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function resolveBuildDate() {
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
  if (typeof sourceDateEpoch === "string" && /^\d+$/.test(sourceDateEpoch)) {
    const milliseconds = Number(sourceDateEpoch) * 1000;
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
      return new Date(milliseconds).toISOString();
    }
  }
  return new Date().toISOString();
}

function resolveGitBranch() {
  const ciBranch =
    process.env.GIT_BRANCH ?? process.env.GITHUB_REF_NAME ?? process.env.CI_COMMIT_REF_NAME;
  if (typeof ciBranch === "string" && ciBranch.trim().length > 0) {
    return ciBranch.trim();
  }
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
    if (!branch || branch === "HEAD") {
      return "unknown";
    }
    return branch;
  } catch {
    return "unknown";
  }
}

const appCommitHash = resolveCommitHash();
const appBuildDate = resolveBuildDate();
const appGitBranch = resolveGitBranch();

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@app": fileURLToPath(new URL("./src/features/app", import.meta.url)),
      "@settings": fileURLToPath(new URL("./src/features/settings", import.meta.url)),
      "@threads": fileURLToPath(new URL("./src/features/threads", import.meta.url)),
      "@services": fileURLToPath(new URL("./src/services", import.meta.url)),
      "@utils": fileURLToPath(new URL("./src/utils", import.meta.url)),
      "@tauri-apps/api/core": fileURLToPath(new URL("./src/shims-web/tauri-core.ts", import.meta.url)),
      "@tauri-apps/api/event": fileURLToPath(new URL("./src/shims-web/tauri-event.ts", import.meta.url)),
      "@tauri-apps/api/window": fileURLToPath(new URL("./src/shims-web/tauri-window.ts", import.meta.url)),
      "@tauri-apps/api/menu": fileURLToPath(new URL("./src/shims-web/tauri-menu.ts", import.meta.url)),
      "@tauri-apps/api/dpi": fileURLToPath(new URL("./src/shims-web/tauri-dpi.ts", import.meta.url)),
      "@tauri-apps/api/webview": fileURLToPath(new URL("./src/shims-web/tauri-webview.ts", import.meta.url)),
      "@tauri-apps/api/app": fileURLToPath(new URL("./src/shims-web/tauri-app.ts", import.meta.url)),
      "@tauri-apps/plugin-dialog": fileURLToPath(new URL("./src/shims-web/tauri-plugin-dialog.ts", import.meta.url)),
      "@tauri-apps/plugin-opener": fileURLToPath(new URL("./src/shims-web/tauri-plugin-opener.ts", import.meta.url)),
      "@tauri-apps/plugin-notification": fileURLToPath(new URL("./src/shims-web/tauri-plugin-notification.ts", import.meta.url)),
      "@tauri-apps/plugin-updater": fileURLToPath(new URL("./src/shims-web/tauri-plugin-updater.ts", import.meta.url)),
      "@tauri-apps/plugin-process": fileURLToPath(new URL("./src/shims-web/tauri-plugin-process.ts", import.meta.url)),
      "tauri-plugin-liquid-glass-api": fileURLToPath(new URL("./src/shims-web/tauri-liquid-glass.ts", import.meta.url)),
    },
  },
  worker: {
    format: "es",
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_COMMIT_HASH__: JSON.stringify(appCommitHash),
    __APP_BUILD_DATE__: JSON.stringify(appBuildDate),
    __APP_GIT_BRANCH__: JSON.stringify(appGitBranch),
  },
  build: {
    outDir: "embed-dist",
    emptyOutDir: true,
  },
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
