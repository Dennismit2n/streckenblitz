// Bildschirmfotos und Bildrate für Streckenblitz über Edge headless und das DevTools-Protokoll (Muster Kugelblitz).
//   node werkzeuge/foto.mjs <zielordner> [szene ...]
//   Szenen: fahrt (Menü, dann Bot allein in freier Fahrt, Fotos nach einigen Sekunden), stellen (Fotos an festen Stellen der Strecke),
//           bedienung (Tasten, Takt der Zahlen, Rundenanzeige),
//           fps (Bildrate über requestAnimationFrame, je Strecke 8 s lang, Bot am Steuer im Rennen mit 8 Autos),
//           strecken (je Strecke: Startaufstellung mit Ampel, Kurve mit Deko, Pulk nach dem Start)
//   Rennen, Startampel und Ergebnis prüft und fotografiert tests/spiel.mjs.
//   Vorgabe ohne Szenen: fahrt, stellen, bedienung, fps. Größe 1440 × 900.
//   OHNE_GPU=1: Edge ohne Grafikbeschleunigung starten (zum Vergleich der Bildrate).
//   BASIS=…: andere Adresse als die Vorschau auf Port 8644.
// Startet genau ein Edge mit eigenem Profil im Temp-Ordner und beendet es am Ende sicher.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9337;
const BASIS = process.env.BASIS || "http://127.0.0.1:8644/index.html";
const OHNE_GPU = !!process.env.OHNE_GPU;
const ziel = process.argv[2];
if (!ziel) { console.error("Aufruf: node werkzeuge/foto.mjs <zielordner> [fahrt stellen fps]"); process.exit(1); }
const szenen = process.argv.slice(3).length ? process.argv.slice(3) : ["fahrt", "stellen", "bedienung", "fps"];
const STRECKEN = ["moewenkap", "mondsenke", "tannenjoch"];
// Kurven mit Deko für die Szene strecken: Stück und Segmente Anlauf
const KURVEN = {
  moewenkap: [["kurve", "Haarnadel am Leuchtturm", 84], ["hafen", "Hafenmole", 30]],
  mondsenke: [["kurve", "Kaktuskehre", 84], ["felsen", "Felsentor", 60]],
  tannenjoch: [["kurve", "Jägerkehre", 78], ["dorf", "Dorfgerade", 28]],
};
fs.mkdirSync(ziel, { recursive: true });
const profil = path.join(os.tmpdir(), "streckenblitz-edge-foto");
fs.rmSync(profil, { recursive: true, force: true });

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profil,
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--force-color-profile=srgb",
  "--window-size=1440,900", ...(OHNE_GPU ? ["--disable-gpu"] : []), "about:blank"], { stdio: "ignore" });

let ws;
let nr = 0;
const offen = new Map();
const meldungen = [];
async function verbinden() {
  for (let i = 0; i < 60; i++) {
    try {
      const liste = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const seite = liste.find((t) => t.type === "page");
      if (seite) {
        ws = new WebSocket(seite.webSocketDebuggerUrl);
        await new Promise((r, f) => { ws.onopen = r; ws.onerror = f; });
        ws.onmessage = (m) => {
          const d = JSON.parse(m.data);
          if (d.id && offen.has(d.id)) { offen.get(d.id)(d); offen.delete(d.id); }
          if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) {
            meldungen.push(d.params.type + ": " + d.params.args.map((a) => a.value ?? a.description).join(" "));
          }
          if (d.method === "Runtime.exceptionThrown") meldungen.push("Ausnahme: " + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
          if (d.method === "Log.entryAdded" && (d.params.entry.level === "error" || d.params.entry.level === "warning")) meldungen.push("log " + d.params.entry.level + ": " + d.params.entry.text + " " + (d.params.entry.url || ""));
        };
        return;
      }
    } catch { /* noch nicht da */ }
    await warte(250);
  }
  throw new Error("Edge antwortet nicht");
}
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const i = ++nr;
  offen.set(i, (d) => (d.error ? rej(new Error(method + ": " + d.error.message)) : res(d.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
async function js(code) {
  const r = await cdp("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function laden(url) {
  await cdp("Page.navigate", { url });
  await warte(1500);
}
async function foto(datei) {
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(ziel, datei), Buffer.from(r.data, "base64"));
  console.log("Foto", datei);
}
const zustand = `(() => { const a = window.streckenblitz.auto, s = window.streckenblitz.strecke;
  return "Runde " + a.runde + ", z " + Math.round(a.z) + " (" + s.stuecke[s.segment(a.z).stueck].name + "), x " + a.x.toFixed(2) +
    ", " + Math.round(a.tempo * 0.026) + " km/h, " + a.untergrund + ", Zeiten " + JSON.stringify(a.rundenZeiten.map((t) => +t.toFixed(2))); })()`;

// Feste Stellen für Fotos: Segment, an dem der Bot startet, und Wartezeit, bis er Tempo hat
const STELLEN = [
  { name: "moewenbogen", stueck: "Möwenbogen", vorlauf: 160 },
  { name: "kuppe", stueck: "Klippengerade, zweite Kuppe", vorlauf: 150 },
  { name: "schikane", stueck: "Schikane links", vorlauf: 130 },
  { name: "haarnadel", stueck: "Haarnadel am Leuchtturm", vorlauf: 110 },
  { name: "zielbogen", stueck: "Zielbogen", vorlauf: 150 },
];

try {
  await verbinden();
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  const endung = OHNE_GPU ? "-ohne-gpu" : "";

  if (szenen.includes("fahrt")) {
    await laden(BASIS + "?strecke=moewenkap");
    await foto("menue-1440" + endung + ".png");
    await laden(BASIS + "?bot=1&modus=frei&strecke=moewenkap");
    for (const s of [4, 9, 15]) {
      await warte(s === 4 ? 4000 : s === 9 ? 5000 : 6000);
      console.log("nach", s, "s:", await js(zustand));
      await foto("fahrt-" + s + "s-1440" + endung + ".png");
    }
  }

  if (szenen.includes("stellen")) {
    for (const st of STELLEN) {
      const segment = await (async () => {
        await laden(BASIS + "?strecke=moewenkap");
        return js(`(() => { const s = window.streckenblitz.strecke; const t = s.stuecke.find((x) => x.name === ${JSON.stringify(st.stueck)}); return t ? t.von : -1; })()`);
      })();
      if (segment < 0) { console.log("Stück fehlt:", st.stueck); continue; }
      const start = Math.max(0, segment - st.vorlauf);
      await laden(BASIS + "?bot=1&strecke=moewenkap&start=" + start);
      // warten, bis der Bot das Stück erreicht hat
      for (let i = 0; i < 80; i++) {
        const n = await js(`(() => { const a = window.streckenblitz.auto, s = window.streckenblitz.strecke; return s.segment(a.z).nr; })()`);
        if (n >= segment + 2) break;
        await warte(100);
      }
      console.log(st.name + ":", await js(zustand));
      await foto("stelle-" + st.name + "-1440" + endung + ".png");
    }
  }

  if (szenen.includes("bedienung")) {
    // Tasten über echte Eingabe-Ereignisse des Protokolls
    const VK = { KeyW: 87, KeyA: 65, KeyS: 83, KeyD: 68, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32 };
    const taste = (code, art) => cdp("Input.dispatchKeyEvent", { type: art, code, key: code === "Space" ? " " : code, windowsVirtualKeyCode: VK[code] });
    const wert = (ausdruck) => js(`(() => { const a = window.streckenblitz.auto; return ${ausdruck}; })()`);
    const e = [];
    for (const [gas, bremse, rechts, links] of [["KeyW", "KeyS", "KeyD", "KeyA"], ["ArrowUp", "Space", "ArrowRight", "ArrowLeft"], ["ArrowUp", "ArrowDown", "ArrowRight", "ArrowLeft"]]) {
      await laden(BASIS + "?modus=frei");
      await taste(gas, "keyDown"); await warte(2000);
      const t1 = await wert("a.tempo * 0.026");
      await taste(rechts, "keyDown"); await warte(250);
      const l1 = await wert("a.lenk");
      await taste(rechts, "keyUp"); await taste(links, "keyDown"); await warte(300);
      const l2 = await wert("a.lenk");
      await taste(links, "keyUp"); await taste(gas, "keyUp"); await taste(bremse, "keyDown"); await warte(500);
      const t2 = await wert("a.tempo * 0.026");
      await taste(bremse, "keyUp");
      e.push(`${gas}: ${t1.toFixed(0)} km/h nach 2 s, ${rechts} lenkt ${l1.toFixed(2)}, ${links} lenkt ${l2.toFixed(2)}, ${bremse} bremst auf ${t2.toFixed(0)} km/h`);
    }
    console.log("Tasten:\n  " + e.join("\n  "));
    // Takt der Zahlen: Wechsel der Texte von Zeit, Tempo und Platz 8 s lang mitschreiben, kleinster Abstand muss 0,5 s sein
    await laden(BASIS + "?bot=1&samen=2");
    await warte(5500); // Startampel abwarten
    const takt = await js(`(async () => {
      const zeiten = { zeit: [], tempo: [], platz: [] }, mo = [];
      for (const id of Object.keys(zeiten)) { const o = new MutationObserver(() => zeiten[id].push(performance.now())); o.observe(document.getElementById(id), { childList: true, characterData: true, subtree: true }); mo.push(o); }
      await new Promise((r) => setTimeout(r, 8000));
      mo.forEach((o) => o.disconnect());
      const erg = {};
      for (const [id, t] of Object.entries(zeiten)) { let min = Infinity; for (let i = 1; i < t.length; i++) min = Math.min(min, t[i] - t[i - 1]); erg[id] = { wechsel: t.length, kleinsterAbstand_ms: Math.round(min) }; }
      return erg; })()`);
    const ok = Object.values(takt).every((v) => v.kleinsterAbstand_ms >= 495);
    console.log("Zahlenwechsel in 8 s:", JSON.stringify(takt), ok ? "ok, nie schneller als alle 0,5 s" : "ZU SCHNELL");
    // Rundenanzeige: kurz vor der Linie starten, danach stehen letzte und beste Zeit da
    const anz = await js(`window.streckenblitz.strecke.anzahl`);
    await laden(BASIS + "?bot=1&start=" + (anz - 60));
    await warte(5000);
    const hud = await js(`["runde", "zeit", "letzte", "beste"].map((id) => id + " " + document.getElementById(id).textContent).join(", ")`);
    console.log("Anzeige nach der Linie:", hud, "|", await js(zustand));
    await foto("runde-1440" + endung + ".png");
  }

  if (szenen.includes("strecken")) {
    for (const id of STRECKEN) {
      await laden(BASIS + "?strecke=" + id + "&bot=1&samen=3");
      for (let i = 0; i < 60 && !(await js(`window.streckenblitz.rennen.ampel.an === 3`)); i++) await warte(100);
      await foto("strecke-" + id + "-start-1440" + endung + ".png");
      for (let i = 0; i < 120 && !(await js(`window.streckenblitz.rennen.spieler.zeit > 4.5`)); i++) await warte(100);
      await foto("strecke-" + id + "-pulk-1440" + endung + ".png");
      for (const [name, stueck, anlauf] of KURVEN[id]) {
        const segment = await js(`window.streckenblitz.strecke.stuecke.find((x) => x.name === ${JSON.stringify(stueck)}).von`);
        await laden(BASIS + "?strecke=" + id + "&bot=1&start=" + Math.max(0, segment - anlauf));
        for (let i = 0; i < 80; i++) {
          const n = await js(`(() => { const a = window.streckenblitz.auto, s = window.streckenblitz.strecke; return s.segment(a.z).nr; })()`);
          if (n >= segment - 12) break;
          await warte(50);
        }
        console.log(id + " " + name + ":", await js(zustand));
        await foto("strecke-" + id + "-" + name + "-1440" + endung + ".png");
      }
    }
  }

  if (szenen.includes("fps")) for (const id of STRECKEN) {
    await laden(BASIS + "?bot=1&samen=2&strecke=" + id);
    await warte(7000); // Startampel abwarten, gemessen wird mit dem fahrenden Feld
    const m = await js(`(async () => {
      const zeiten = []; let letzt = performance.now(); const t0 = letzt;
      await new Promise((res) => { const f = (t) => { zeiten.push(t - letzt); letzt = t; if (t - t0 < 8000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      zeiten.shift();
      const sortiert = [...zeiten].sort((a, b) => a - b);
      const summe = zeiten.reduce((s, x) => s + x, 0);
      return { bilder: zeiten.length, fps: +(1000 * zeiten.length / summe).toFixed(1), median_ms: +sortiert[Math.floor(sortiert.length / 2)].toFixed(2),
        p95_ms: +sortiert[Math.floor(sortiert.length * 0.95)].toFixed(2), max_ms: +sortiert[sortiert.length - 1].toFixed(2),
        leinwand: [document.getElementById("leinwand").width, document.getElementById("leinwand").height] };
    })()`);
    // Zeichenzeit je Bild direkt gemessen (ohne Warten auf den Bildtakt)
    const zz = await js(`(() => { const g = window.streckenblitz.grafik, a = window.streckenblitz.auto; const t0 = performance.now();
      for (let i = 0; i < 300; i++) g.zeichne({ z: a.z + i * 40, x: a.x, lenk: 0, untergrund: "strasse", himmelX: i });
      return +((performance.now() - t0) / 300).toFixed(3); })()`);
    console.log("Bildrate " + id + (OHNE_GPU ? " ohne GPU" : "") + ":", JSON.stringify(m), "| Zeichnen je Bild", zz, "ms");
  }

  console.log("Konsole:", meldungen.length ? "\n  " + meldungen.join("\n  ") : "keine Fehler, keine Warnungen");
} catch (e) {
  console.error("Fehler:", e.message);
  process.exitCode = 1;
} finally {
  try { await cdp("Browser.close"); } catch { /* schon zu */ }
  await warte(800);
  try { edge.kill(); } catch { /* egal */ }
}
