import { chromium } from "playwright";
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const lines = [];
page.on("console", (m) => lines.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => lines.push(`PAGEERROR: ${e.stack || e.message}`));
page.on("requestfailed", (r) => lines.push(`REQFAIL: ${r.url()} ${r.failure()?.errorText}`));
await page.goto("http://localhost:8000", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(25000);
const info = await page.evaluate(() => ({
  phaserVersion: window.Phaser?.VERSION ?? null,
  webgl: (() => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return "err:" + e.message; } })(),
  appChildren: document.getElementById("app")?.children?.length ?? "no #app",
  appHTML: (document.getElementById("app")?.innerHTML || "").slice(0, 300),
  canvasCount: document.querySelectorAll("canvas").length,
  bodyText: document.body.innerText.slice(0, 300),
}));
console.log("=== INFO ===");
console.log(JSON.stringify(info, null, 2));
console.log("=== CONSOLE (last 60) ===");
console.log(lines.slice(-60).join("\n"));
await browser.close();
