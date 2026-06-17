import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("http://localhost:8000", { waitUntil: "domcontentloaded", timeout: 60000 });
const getScene = `(() => { const looks=(s)=>!!s&&typeof s.getPlayerParty==="function"&&!!s.ui&&typeof s.ui.getMode==="function"; const pool=globalThis.Phaser?.Display?.Canvas?.CanvasPool?.pool??[]; for(const e of pool){const ss=e?.parent?.game?.scene?.scenes; if(Array.isArray(ss)){const m=ss.find(looks); if(m)return m;}} return null; })()`;
// wait for scene
const t0=Date.now(); while(Date.now()-t0<120000){ const ok=await page.evaluate(`!!${getScene}`); if(ok)break; await page.waitForTimeout(2000); }
const info = await page.evaluate(`(() => { const s=${getScene}; if(!s)return{err:"no scene"}; return { enableTutorials: s.enableTutorials, disableMenu: s.disableMenu, tutorialFlags: s.gameData && s.gameData.getTutorialFlags ? s.gameData.getTutorialFlags() : null }; })()`);
console.log("scene.enableTutorials =", info.enableTutorials, "| scene.disableMenu =", info.disableMenu);
await browser.close();
