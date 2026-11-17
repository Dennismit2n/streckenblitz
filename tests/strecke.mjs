// Prüfungen der Streckenlogik und der Fahrphysik, ohne Browser.
//
//   node tests/strecke.mjs
//
// Ausgabe: je Abschnitt die Zahl der Prüfungen, am Ende SUMME und Exit 0 (alles gut) oder 1.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.join(hier, "..");
const require = createRequire(import.meta.url);
const S = require(path.join(wurzel, "strecke.js"));
const P = require(path.join(wurzel, "physik.js"));

const fehler = [];
let gesamt = 0;
let abschnittZaehler = 0;
let abschnittName = "";
const ausgabe = [];
function abschnitt(name) {
  if (abschnittName) ausgabe.push(`  ${abschnittName.padEnd(44)} ${abschnittZaehler} Prüfungen`);
  abschnittName = name;
  abschnittZaehler = 0;
}
function pruefe(bedingung, text) {
  gesamt++;
  abschnittZaehler++;
  if (!bedingung) fehler.push(`[${abschnittName}] ${text}`);
}

const L = S.KONST.SEGMENT_LAENGE;
const strecke = S.baue(S.PLAENE.moewenkap);
const seg = strecke.segmente;

// --- Strecke --------------------------------------------------------------------
abschnitt("Strecke geschlossen");
pruefe(strecke.anzahl > 1000, "mehr als 1000 Segmente (" + strecke.anzahl + ")");
pruefe(strecke.laenge === strecke.anzahl * L, "Länge = Segmente mal Segmentlänge");
pruefe(seg[0].y1 === 0, "Start auf Höhe 0");
pruefe(Math.abs(seg[seg.length - 1].y2 - seg[0].y1) < 1e-9, "Ende auf derselben Höhe wie der Anfang (" + seg[seg.length - 1].y2 + ")");
let hoeheStetig = true, kurveSanft = true, groessterSprung = 0;
for (let i = 0; i < seg.length; i++) {
  const n = seg[(i + 1) % seg.length];
  if (Math.abs(seg[i].y2 - n.y1) > 1e-9) hoeheStetig = false;
  const sprung = Math.abs(n.kurve - seg[i].kurve);
  groessterSprung = Math.max(groessterSprung, sprung);
  if (sprung > 1.2) kurveSanft = false;
}
pruefe(hoeheStetig, "Höhe stetig von Segment zu Segment, auch über die Ziellinie");
pruefe(kurveSanft, "Kurven laufen sanft ein und aus (größter Sprung " + groessterSprung.toFixed(2) + ")");
pruefe(Math.abs(seg[0].kurve) < 1e-9 && Math.abs(seg[seg.length - 1].kurve) < 1e-9, "Ziellinie auf gerader Strecke");
const ende = strecke.karte.ende;
pruefe(Math.hypot(ende.x, ende.y) < L, "Karte: Ende fällt mit dem Anfang zusammen (Abstand " + Math.hypot(ende.x, ende.y).toFixed(1) + ")");
pruefe(Math.abs(ende.richtung - 2 * Math.PI) < 1e-9, "Karte: genau eine Umdrehung im Uhrzeigersinn");
pruefe(Math.abs(strecke.hoeheBei(strecke.laenge - 1) - strecke.hoeheBei(0)) < 50, "Höhe kurz vor und auf der Linie fast gleich");
pruefe(strecke.segment(-1).nr === strecke.anzahl - 1 && strecke.segment(strecke.laenge).nr === 0, "Segmentsuche läuft über die Runde hinaus");

abschnitt("Strecke enthält");
const stueckWinkel = (st) => {
  let s = 0;
  for (let i = st.von; i < st.bis; i++) s += seg[i].kurve;
  return (s * strecke.karte.proKurve * 180) / Math.PI;
};
const haarnadel = strecke.stuecke.find((st) => Math.abs(st.kurve) >= 7 && Math.abs(stueckWinkel(st)) >= 150);
pruefe(!!haarnadel, "eine Haarnadel (enge Kurve über mindestens 150 Grad)" + (haarnadel ? ": " + haarnadel.name + " " + stueckWinkel(haarnadel).toFixed(0) + " Grad" : ""));
let laengsteGerade = 0, lauf = 0;
for (let i = 0; i < seg.length * 2; i++) {
  if (Math.abs(seg[i % seg.length].kurve) < 1e-9) { lauf++; laengsteGerade = Math.max(laengsteGerade, lauf); } else lauf = 0;
}
pruefe(laengsteGerade >= 300, "eine lange Gerade, mindestens 300 Segmente (" + laengsteGerade + ")");
let schikane = false;
for (let i = 0; i < strecke.stuecke.length - 1; i++) {
  const a = strecke.stuecke[i], b = strecke.stuecke[i + 1];
  if (Math.abs(a.kurve) >= 4 && Math.abs(b.kurve) >= 4 && a.kurve * b.kurve < 0 && b.bis - a.von <= 60) schikane = true;
}
pruefe(schikane, "eine Schikane (zwei enge Gegenkurven direkt hintereinander)");
// Kuppen: Hochpunkte, hinter denen es mindestens 1500 Einheiten bergab geht und die man von unten anfährt
let kuppen = 0;
for (let i = 1; i < seg.length - 1; i++) {
  const y = seg[i].y2;
  if (y >= seg[i - 1].y2 && y > seg[i + 1].y2) {
    let vorMin = y, nachMin = y;
    for (let k = 1; k <= 120; k++) { vorMin = Math.min(vorMin, seg[(i - k + seg.length) % seg.length].y2); nachMin = Math.min(nachMin, seg[(i + k) % seg.length].y2); }
    if (y - nachMin >= 1500 && y - vorMin >= 1500) kuppen++;
  }
}
pruefe(kuppen >= 2, "mindestens zwei Kuppen (" + kuppen + ")");

abschnitt("Flimmerschutz der Wechselfarben");
function leuchtdichte(hex) {
  const n = parseInt(hex.slice(1), 16);
  const k = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
}
function kontrast(a, b) {
  const la = leuchtdichte(a), lb = leuchtdichte(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
for (const name of ["gras", "randstein", "strasse"]) {
  const [a, b] = strecke.farben[name];
  const k = kontrast(a, b);
  pruefe(k < 1.25, name + ": Kontrast der Wechselfarben unter 1,25 (" + k.toFixed(3) + ")");
}
pruefe(strecke.streifen >= 3, "Farbfelder mindestens 3 Segmente lang (" + strecke.streifen + ")");

// --- Physik ----------------------------------------------------------------------
abschnitt("Physik deterministisch");
function fahrt(schritte) {
  const a = P.neuesAuto();
  for (let i = 0; i < schritte; i++) {
    // feste, aber abwechslungsreiche Eingaben: Gas, Lenken in Wellen, ab und zu Bremse
    const e = { gas: i % 400 < 330 ? 1 : 0, bremse: i % 400 >= 360 ? 1 : 0, lenken: Math.sin(i / 47) * (i % 3 === 0 ? 1 : 0.6) };
    P.schritt(a, e, strecke);
  }
  return JSON.stringify(a);
}
const lauf1 = fahrt(4000), lauf2 = fahrt(4000);
pruefe(lauf1 === lauf2, "zweimal gleiche Eingaben, gleicher Zustand nach 4000 Takten");
pruefe(JSON.parse(lauf1).z > 0, "das Auto ist dabei vorangekommen");
{
  const a = P.neuesAuto(), b = P.neuesAuto();
  const ua = { konto: 0 }, ub = { konto: 0 };
  let ta = 0, tb = 0;
  for (let i = 0; i < 144 * 3; i++) P.takt(ua, 1 / 144, () => { ta++; P.schritt(a, { gas: 1 }, strecke); });
  for (let i = 0; i < 60 * 3; i++) P.takt(ub, 1 / 60, () => { tb++; P.schritt(b, { gas: 1 }, strecke); });
  pruefe(ta === tb, "144 Hz und 60 Hz ergeben gleich viele Takte in 3 s (" + ta + " und " + tb + ")");
  pruefe(ta === tb && Math.abs(a.z - b.z) < 1e-6, "und dieselbe Strecke (" + a.z.toFixed(1) + " und " + b.z.toFixed(1) + ")");
  const uc = { konto: 0 };
  let tc = 0;
  P.takt(uc, 5, () => tc++);
  pruefe(tc === Math.floor(P.KONST.MAX_NACHHOLZEIT / P.KONST.TAKT + 1e-9), "Sprung von 5 s (Tab im Hintergrund) wird gedeckelt (" + tc + " Takte)");
}

abschnitt("Physik Fahrgefühl");
{
  const kurvenSeg = seg.find((g) => Math.abs(g.kurve - 8) < 1e-9);
  const messeFlieh = (anteil) => {
    const a = P.neuesAuto(kurvenSeg.z1 + 10, 0);
    a.tempo = anteil * P.KONST.HOECHST;
    P.schritt(a, { gas: 1 }, strecke);
    return a.flieh;
  };
  const voll = messeFlieh(1), halb = messeFlieh(0.5);
  pruefe(voll > 0 && Math.abs(voll / halb - 4) < 0.15, "Fliehkraft wächst mit dem Quadrat des Tempos (Verhältnis " + (voll / halb).toFixed(2) + ")");
  const a = P.neuesAuto(kurvenSeg.z1 + 10, 0);
  a.tempo = P.KONST.HOECHST;
  P.schritt(a, { gas: 1 }, strecke);
  pruefe(a.x < 0, "in der Rechtskurve trägt die Fliehkraft nach links außen");
  pruefe(P.grenzAnteil(8) < 0.5 && P.grenzAnteil(2) > 1, "Haarnadel nur langsam, flache Kurve voll fahrbar (" + P.grenzAnteil(8).toFixed(2) + ", " + P.grenzAnteil(2).toFixed(2) + ")");
}
{
  const a = P.neuesAuto(1000, 2);
  a.tempo = P.KONST.HOECHST;
  let tempo1s = 0;
  for (let i = 0; i < 180; i++) { P.schritt(a, { gas: 1 }, strecke); if (i === 59) tempo1s = a.tempo; }
  const deckel = P.KONST.GRAS_HOECHST * P.KONST.HOECHST;
  pruefe(a.untergrund === "gras", "x = 2 liegt im Gras");
  pruefe(tempo1s < 0.5 * P.KONST.HOECHST, "Gras bremst stark: nach 1 s unter halbem Höchsttempo (" + Math.round(P.kmh(tempo1s)) + " km/h)");
  pruefe(a.tempo <= deckel + 1e-6, "Gras begrenzt das Höchsttempo (" + Math.round(P.kmh(a.tempo)) + " km/h)");
  const b = P.neuesAuto(1000, 2);
  for (let i = 0; i < 600; i++) P.schritt(b, { gas: 1 }, strecke);
  pruefe(b.tempo <= deckel + 1e-6 && b.tempo > deckel * 0.9, "aus dem Stand im Gras nicht über das Grastempo");
}
{
  const strasse = P.neuesAuto(1000, 0), rand = P.neuesAuto(1000, 1.07);
  strasse.tempo = rand.tempo = 0.7 * P.KONST.HOECHST;
  for (let i = 0; i < 60; i++) { P.schritt(strasse, { gas: 1 }, strecke); P.schritt(rand, { gas: 1 }, strecke); }
  pruefe(rand.untergrund === "randstein", "x = 1,07 liegt auf dem Randstein");
  const verlust = (strasse.tempo - rand.tempo) / strasse.tempo;
  pruefe(verlust > 0 && verlust < 0.15, "Randstein bremst nur leicht (" + (verlust * 100).toFixed(1) + " % weniger nach 1 s)");
}
{
  const a = P.neuesAuto(1000, 0);
  for (let i = 0; i < 1200; i++) P.schritt(a, { gas: 1 }, strecke);
  pruefe(a.tempo <= P.KONST.HOECHST, "nie schneller als das Höchsttempo");
  const b = P.neuesAuto(1000, 0);
  b.tempo = P.KONST.HOECHST;
  let t = 0;
  while (b.tempo > 0 && t < 600) { P.schritt(b, { bremse: 1 }, strecke); t++; }
  pruefe(t / 60 > 0.8 && t / 60 < 2.5, "Vollbremsung aus Höchsttempo dauert 0,8 bis 2,5 s (" + (t / 60).toFixed(2) + " s)");
  const c = P.neuesAuto(1000, 0);
  c.tempo = P.KONST.HOECHST * 0.6;
  for (let i = 0; i < 6; i++) P.schritt(c, { gas: 1, lenken: 1 }, strecke);
  pruefe(c.lenk > 0.3 && c.lenk < 0.9, "Lenkung folgt mit Trägheit (nach 0,1 s Einschlag " + c.lenk.toFixed(2) + ")");
}
{
  // Rundenzeit auf den Bruchteil eines Takts: 1000 Einheiten vor der Linie mit Höchsttempo auf gerader, ebener Bahn
  const a = P.neuesAuto(strecke.laenge - 1000, 0);
  a.tempo = P.KONST.HOECHST;
  while (a.rundenZeiten.length === 0) P.schritt(a, { gas: 1 }, strecke);
  const soll = 1000 / P.KONST.HOECHST;
  pruefe(Math.abs(a.letzte - soll) < 1e-9, "Rundenzeit genau auf den Zeitpunkt der Linie (" + a.letzte.toFixed(5) + " statt " + soll.toFixed(5) + ")");
  pruefe(a.runde === 2 && a.beste === a.letzte, "Runde und Bestzeit fortgeschrieben");
}

// --- Bot -----------------------------------------------------------------------
abschnitt("Bot fährt Runden");
function botRennen(vorsicht, maxZeit, runden) {
  const a = P.neuesAuto();
  let steht = 0, maxSteht = 0, gras = 0, takte = 0;
  while (a.rundenZeiten.length < runden && a.zeit < maxZeit) {
    P.schritt(a, P.botEingabe(a, strecke, vorsicht), strecke);
    takte++;
    if (a.zeit > 3 && a.tempo < 0.05 * P.KONST.HOECHST) { steht++; maxSteht = Math.max(maxSteht, steht); } else steht = 0;
    if (a.untergrund === "gras") gras++;
  }
  return { a, maxSteht, gras, takte };
}
const r = botRennen(0.9, 300, 3);
pruefe(r.a.rundenZeiten.length >= 2, "mindestens 2 Runden in 300 s (" + r.a.rundenZeiten.length + ")");
pruefe(r.maxSteht === 0, "bleibt nie stecken (Takte unter 5 % Tempo nach dem Start: " + r.maxSteht + ")");
pruefe(r.gras === 0, "kommt nicht ins Gras (" + r.gras + " Takte)");
for (const [i, t] of r.a.rundenZeiten.entries()) pruefe(t >= 45 && t <= 70, "Runde " + (i + 1) + " im Zielfenster 45 bis 70 s (" + t.toFixed(2) + " s)");
const vorsichtig = botRennen(0.75, 300, 2);
pruefe(vorsichtig.a.rundenZeiten.length >= 2 && vorsichtig.maxSteht === 0, "auch ein vorsichtiger Bot schafft 2 Runden (" + vorsichtig.a.rundenZeiten.map((t) => t.toFixed(1)).join(", ") + " s)");
pruefe(Math.max(...vorsichtig.a.rundenZeiten) <= 70, "vorsichtige Runden bleiben unter 70 s");
const b1 = botRennen(0.9, 120, 1), b2 = botRennen(0.9, 120, 1);
pruefe(b1.a.letzte === b2.a.letzte, "Bot fährt zweimal exakt gleich (" + b1.a.letzte.toFixed(3) + " s)");

// --- Texte und Dateien --------------------------------------------------------------
abschnitt("Texte und Dateien");
function dateien(ordner) {
  const liste = [];
  for (const e of fs.readdirSync(ordner, { withFileTypes: true })) {
    if ([".git", "_intern", "fotos", "node_modules", "schrift", ".claude"].includes(e.name)) continue;
    const p = path.join(ordner, e.name);
    if (e.isDirectory()) liste.push(...dateien(p));
    else if (/\.(html|js|mjs|css|json|webmanifest|svg|md|txt)$/.test(e.name) || e.name === ".gitignore") liste.push(p);
  }
  return liste;
}
const alle = dateien(wurzel);
pruefe(alle.length >= 6, "mindestens 6 Textdateien gefunden (" + alle.length + ")");
const STRICHE = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
const PFAD = /[A-Za-z]:[\\/]+Users[\\/]/i;
for (const d of alle) {
  const text = fs.readFileSync(d, "utf8");
  const name = path.relative(wurzel, d);
  const zeile = text.split("\n").findIndex((z) => STRICHE.test(z));
  pruefe(zeile < 0, name + ": keine Gedankenstriche" + (zeile >= 0 ? " (Zeile " + (zeile + 1) + ")" : ""));
  pruefe(!PFAD.test(text), name + ": kein Benutzerpfad");
}

abschnitt("");
console.log("Streckenblitz, Logik ohne Browser (" + strecke.name + ", " + strecke.anzahl + " Segmente, Runde " + (strecke.laenge / 1000).toFixed(1) + " tausend Einheiten)");
console.log(ausgabe.join("\n"));
console.log("  Bot-Runden: " + r.a.rundenZeiten.map((t) => t.toFixed(2) + " s").join(", "));
console.log(`\nSUMME: ${gesamt} Prüfungen, ${fehler.length} Fehler`);
if (fehler.length) {
  console.log("\n" + fehler.join("\n"));
  process.exit(1);
}
