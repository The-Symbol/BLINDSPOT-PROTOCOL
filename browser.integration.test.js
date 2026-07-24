import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

function findBrowser() {
  const candidates = [
    process.env.BROWSER_BIN,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  return candidates.find(existsSync) || null;
}

function serveProject() {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "mobile-browser.integration.html" : pathname.slice(1);
    const target = path.resolve(root, relative);
    if (!target.startsWith(root) || !existsSync(target)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": types[path.extname(target)] || "application/octet-stream" });
    response.end(readFileSync(target));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function dumpDom(browser, url) {
  return new Promise((resolve, reject) => {
    const profile = path.join(os.tmpdir(), `blindspot-browser-test-${process.pid}-${Date.now()}`);
    const child = spawn(browser, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${profile}`, "--window-size=844,390", "--virtual-time-budget=3000",
      "--dump-dom", url,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `Browser exited ${code}`)));
  });
}

test("mobile controls pass in a real Chromium browser", async (context) => {
  const browser = findBrowser();
  if (!browser) {
    if (process.env.REQUIRE_BROWSER_TESTS === "1") assert.fail("Chromium browser not found");
    context.skip("Set BROWSER_BIN to run the browser integration test");
    return;
  }
  const server = await serveProject();
  try {
    const address = server.address();
    const dom = await dumpDom(browser, `http://127.0.0.1:${address.port}/mobile-browser.integration.html`);
    assert.match(dom, /data-status="passed"/, dom);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
