/*
 * Streckenblitz: Pseudo-3D-Zeichner
 *
 * Das Spielbild entsteht in einem kleinen Bild von 427 × 240 Pixeln (16:9), das index.html
 * ganzzahlig und scharf vergrößert. Kleines Raster mit sichtbaren Pixeln, aber volle Farben:
 *  - Himmel als Verlauf in der Abenddämmerung (leicht gerastert, damit keine Stufen entstehen),
 *    tief stehende Sonne, ferne Berge mit Lichtkante und nahe Hügel im Dunst, beide mit Parallaxe.
 *  - Straße aus Segmenten: Jedes Segment wird auf den Bildschirm projiziert, gezeichnet wird
 *    zeilenweise von vorn nach hinten. maxY merkt sich die höchste schon belegte Zeile, so
 *    verdecken Kuppen alles dahinter.
 *  - Dunst: Farben ferner Segmente laufen zur Nebelfarbe der Strecke.
 *  - Wechselstreifen (Randsteine, Gras, Asphalt) mit kleinem Helligkeitsunterschied, damit bei
 *    Tempo nichts flimmert.
 *  - Das eigene Auto ist ein Pixel-Sprite aus Code (drei Bilder: links, gerade, rechts).
 *
 * Läuft nur im Browser (braucht Canvas), Fenstername window.Grafik.
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik();
  else wurzel.Grafik = fabrik();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const B = 427, H = 240;
  const HORIZONT = 100;                 // Zeile des Horizonts bei ebener Straße
  const KAMERA_HOEHE = 1300;
  const TIEFE = 1 / Math.tan((50 * Math.PI) / 180); // Sichtfeld 100 Grad
  const ABSTAND = KAMERA_HOEHE * TIEFE;  // so weit steht die Kamera hinter dem Auto
  const SICHT = 300;                     // Segmente Sichtweite
  const NEBEL = 4.2;                     // Dichte des Dunsts
  const PANORAMA = Math.round(B * 360 / 100); // Himmelsbahn: eine volle Umdrehung, passend zum Sichtfeld
  const ZIEL_SEGMENTE = 2;               // so viele Segmente lang ist das Zielfeld

  // --- Farben ----------------------------------------------------------------

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mische(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function hell(a, f) {
    return [a[0] * f, a[1] * f, a[2] * f];
  }
  // Pixelwert für Uint32Array über ImageData (Byte-Reihenfolge R, G, B, A im Speicher)
  function pack(c) {
    const r = Math.max(0, Math.min(255, Math.round(c[0])));
    const g = Math.max(0, Math.min(255, Math.round(c[1])));
    const b = Math.max(0, Math.min(255, Math.round(c[2])));
    return (255 << 24 | b << 16 | g << 8 | r) >>> 0;
  }
  // Wie pack, aber mit Rasterschwelle (geordnetes 4 × 4-Raster) gegen Stufen in dunklen Verläufen
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.47);
  function packRaster(c, x, y) {
    const d = BAYER[(y & 3) * 4 + (x & 3)];
    return pack([Math.floor(c[0] + d + 0.5), Math.floor(c[1] + d + 0.5), Math.floor(c[2] + d + 0.5)]);
  }
  // Verlauf aus Stopps [[anteil, "#rrggbb"], ...]
  function verlauf(stopps, t) {
    for (let i = 1; i < stopps.length; i++) {
      if (t <= stopps[i][0]) {
        const [t0, c0] = stopps[i - 1], [t1, c1] = stopps[i];
        return mische(rgb(c0), rgb(c1), (t - t0) / (t1 - t0 || 1));
      }
    }
    return rgb(stopps[stopps.length - 1][1]);
  }

  // Wiederholbares Wertrauschen (für Bergkämme und Wolken), feste Saat, also jedes Mal gleich
  function rauschen(laenge, gitter, oktaven, saat) {
    let s = saat >>> 0;
    const zufall = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const werte = new Float32Array(laenge);
    let amp = 1, summe = 0;
    for (let o = 0; o < oktaven; o++) {
      const n = gitter << o;
      const punkte = Array.from({ length: n }, zufall);
      for (let i = 0; i < laenge; i++) {
        const p = (i / laenge) * n;
        const k = Math.floor(p), t = p - k;
        const w = (1 - Math.cos(t * Math.PI)) / 2;
        werte[i] += amp * (punkte[k % n] * (1 - w) + punkte[(k + 1) % n] * w);
      }
      summe += amp;
      amp *= 0.5;
    }
    // auf den vollen Bereich 0 bis 1 strecken, sonst bleiben Kämme flach
    let min = Infinity, max = -Infinity;
    for (const v of werte) { if (v < min) min = v; if (v > max) max = v; }
    for (let i = 0; i < laenge; i++) werte[i] = (werte[i] - min) / (max - min || 1);
    return werte;
  }

  // --- Auto als Pixel-Sprite ---------------------------------------------------

  const AUTO_B = 64, AUTO_H = 34;
  const AUTO_FARBEN = {
    karosse: "#287178", karosseSchatten: "#1f5c63", karosseHell: "#428f93", karosseDunkel: "#18474f", karosseTief: "#0f2b31",
    kante: "#b48a68",       // warme Lichtkante vom Abendhimmel vor dem Auto
    gold: "#b39d68", goldDunkel: "#7a6842",
    carbon: "#1c1b23", carbonHell: "#2d2b35", boden: "#111016",
    reifen: "#141217", reifenHell: "#25222b", reifenKante: "#34303b", reifenLicht: "#4d4045", rille: "#0c0b0f",
    helm: "#cfc3a8", helmDunkel: "#9a8f78", helmStreifen: "#a8925e",
    licht: "#6e2727", lichtKern: "#93372f",
  };

  // Zeichnet ein Auto in einen Canvas-Kontext. neigung: -1 links, 0 gerade, 1 rechts
  function autoZeichnen(ctx, neigung) {
    const F = AUTO_FARBEN;
    const r = (x, y, b, h, f) => { ctx.fillStyle = f; ctx.fillRect(x, y, b, h); };
    // Spiegelbild um die Mitte (Mitte zwischen Pixel 31 und 32)
    const rs = (x, y, b, h, f, versatz) => { r(x + versatz, y, b, h, f); r(AUTO_B - x - b + versatz, y, b, h, f); };
    const oben = neigung * 2;   // Flügel und Helm verschieben sich beim Einlenken am stärksten
    const mitte = neigung;      // Motorabdeckung etwas weniger

    // Reifen hinten (breit), oben abgerundet, Rillen, Glanzband
    for (const links of [true, false]) {
      const x0 = links ? 0 : AUTO_B - 14;
      r(x0 + 1, 14, 12, 1, F.reifenLicht);
      r(x0, 15, 14, 19, F.reifen);
      r(x0 + 1, 15, 12, 1, F.reifenHell);
      r(links ? x0 : x0 + 13, 15, 1, 18, F.reifenKante);
      for (let y = 18; y < 33; y += 3) r(x0 + 1, y, 12, 1, F.rille);
      r(x0 + (links ? 3 : 9), 16, 2, 16, F.reifenHell);
      r(x0, 33, 14, 1, F.boden);
      // Flanke zur Wagenmitte mit Mischungsstreifen
      r(links ? x0 + 13 : x0, 17, 1, 13, F.goldDunkel);
    }
    // Querlenker
    rs(14, 20, 7, 1, F.carbonHell, mitte);
    rs(14, 25, 6, 1, F.carbon, mitte);
    // Unterboden und Diffusor mit Finnen
    r(14, 27, 36, 6, F.boden);
    for (const x of [19, 24, 29, 34, 39, 44]) r(x, 28, 1, 4, F.carbonHell);
    r(14, 32, 36, 1, "#0a090d");
    // Seitenkästen
    rs(14, 19, 12, 8, F.karosseDunkel, mitte);
    rs(15, 18, 10, 1, F.karosseHell, mitte);
    rs(14, 26, 12, 1, F.karosseTief, mitte);
    // Motorabdeckung: Trapez, oben schmal
    for (let y = 9; y < 28; y++) {
      const halb = 4 + Math.round((y - 9) * 0.5);
      const x = 32 - halb + mitte;
      r(x, y, halb, 1, F.karosse);
      r(x + halb, y, halb, 1, F.karosseSchatten);
      r(x, y, 1, 1, F.karosseDunkel);
      r(x + halb * 2 - 1, y, 1, 1, F.karosseTief);
    }
    r(31 + mitte, 9, 1, 17, F.karosseHell);      // Grat in der Mitte, Licht von links
    r(28 + mitte, 9, 8, 1, F.kante);              // Lichtkante oben
    r(22 + mitte, 21, 20, 2, F.gold);             // Zierstreifen
    r(22 + mitte, 23, 20, 1, F.goldDunkel);
    // Rücklicht (gedämpft, leuchtet nicht)
    r(29, 28, 6, 3, F.licht);
    r(31, 29, 2, 1, F.lichtKern);
    // Helm über der Motorabdeckung
    r(28 + oben, 1, 8, 6, F.helm);
    r(29 + oben, 0, 6, 1, F.helm);
    r(28 + oben, 3, 8, 1, F.helmStreifen);
    r(28 + oben, 6, 8, 1, F.helmDunkel);
    r(34 + oben, 1, 1, 2, "#e6dcc4");
    // Heckflügel: Endplatten, Hauptblatt, Klappe, Träger
    r(30 + mitte, 11, 4, 4, F.carbon);
    rs(5, 3, 3, 13, F.carbon, oben);
    rs(5, 3, 3, 1, F.carbonHell, oben);
    r(8 + oben, 5, 48, 3, F.karosseDunkel);
    r(8 + oben, 5, 48, 1, F.kante);
    r(8 + oben, 8, 48, 2, F.karosseTief);
    r(8 + oben, 10, 48, 1, "#0b0a0e");
  }

  // --- Zeichner ---------------------------------------------------------------

  function erzeuge(strecke, neueLeinwand) {
    const bild = neueLeinwand(B, H);
    const ctx = bild.getContext("2d");
    const bilddaten = ctx.createImageData(B, H);
    const pix = new Uint32Array(bilddaten.data.buffer);
    const F = strecke.farben;
    const L = strecke.segmente[0].z2 - strecke.segmente[0].z1;

    // Himmelsbahn über eine volle Umdrehung: Verlauf, Sterne, Wolkenstreifen, Sonne, ferne Berge.
    // Sie dreht sich mit der Fahrtrichtung, die Sonne steht also immer in derselben Himmelsrichtung.
    const himmelH = HORIZONT + 8;
    const himmel = new Uint32Array(PANORAMA * himmelH);
    const dunst = rgb(F.dunst);
    const sonne = rgb(F.sonne);
    const sonneX = ((((strecke.sonne || 0) / 360) * PANORAMA) % PANORAMA + PANORAMA) % PANORAMA;
    const sonneY = HORIZONT - 33, sonneR = 8;
    const abstandSonne = (x) => { let d = x - sonneX; if (d > PANORAMA / 2) d -= PANORAMA; if (d < -PANORAMA / 2) d += PANORAMA; return d; };
    // Kämme: Grat-Rauschen (spitze Gipfel statt runder Buckel)
    const roh = rauschen(PANORAMA, 7, 6, 7);
    const berge = roh.map((v) => 1 - Math.abs(2 * v - 1));
    const wolken = rauschen(PANORAMA, 9, 4, 19);
    const bergFarbe = rgb(F.berge), wolke = rgb(F.wolke), wolkenKante = rgb(F.wolkenKante), stern = rgb(F.stern);
    for (let y = 0; y < himmelH; y++) {
      const grund = verlauf(F.himmel, Math.min(1, y / HORIZONT));
      for (let x = 0; x < PANORAMA; x++) {
        let c = grund;
        const dx = abstandSonne(x);
        const naheSonne = Math.max(0, 1 - Math.abs(dx) / 420);
        // Wolkenstreifen: zwei flache Bänder, die Unterkante fängt das Abendlicht
        for (const [mitte, dicke, schwelle] of [[46, 3.2, 0.6], [60, 2.2, 0.64]]) {
          const dichte = (wolken[(x + mitte * 7) % PANORAMA] - schwelle) * 7;
          const halb = dicke * Math.min(1, Math.max(0, dichte));
          const dy = y - mitte;
          if (halb > 0.3 && Math.abs(dy) <= halb) {
            c = mische(c, wolke, 0.5 * Math.min(1, dichte) * (1 - 0.4 * Math.abs(dy) / (halb + 0.5)));
            if (dy > halb - 1) c = mische(c, wolkenKante, (0.25 + 0.5 * naheSonne) * Math.min(1, dichte));
          }
        }
        // Sonne: gedämpfte Scheibe mit weichem Schein, keine helle Fläche
        const d = Math.hypot(dx, (y - sonneY) * 1.1);
        if (d < sonneR) c = mische(c, sonne, 0.9 - 0.25 * (d / sonneR) * (d / sonneR));
        else if (d < 80) c = mische(c, sonne, 0.24 * Math.pow(1 - d / 80, 2.4));
        // Ferne Berge mit Lichtkante; unter der Sonne ein Sattel, damit sie frei über dem Kamm steht
        const sattel = 0.45 + 0.55 * Math.min(1, Math.abs(dx) / 110);
        const kamm = HORIZONT - 4 - (0.15 + 0.85 * berge[x]) * 22 * sattel;
        if (y >= kamm) {
          const tief = Math.min(1, (y - kamm) / 26);
          c = mische(mische(bergFarbe, dunst, 0.12 + 0.55 * tief), grund, 0.1);
          if (y - kamm < 1) c = mische(c, sonne, 0.1 + 0.4 * naheSonne);
        }
        himmel[y * PANORAMA + x] = packRaster(c, x, y);
      }
    }
    // Sterne: ruhig, ohne Funkeln, nach unten hin seltener und schwächer
    {
      let s = 977;
      const zufall = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 150; i++) {
        const x = Math.floor(zufall() * PANORAMA), y = Math.floor(Math.pow(zufall(), 1.6) * 58);
        if (Math.abs(abstandSonne(x)) < 90) continue;
        const staerke = (0.18 + 0.4 * zufall()) * (1 - y / 70);
        const grund = verlauf(F.himmel, y / HORIZONT);
        himmel[y * PANORAMA + x] = pack(mische(grund, stern, staerke));
      }
    }
    // Nahe Hügel: Höhenprofil, gefärbt von dunkel (Kamm) zu Dunst (Fuß); drehen sich etwas schneller (Parallaxe)
    const huegel = rauschen(PANORAMA, 10, 4, 31);
    const huegelFarbe = rgb(F.huegel);
    const huegelZeile = [];
    for (let i = 0; i < 24; i++) huegelZeile.push(pack(mische(huegelFarbe, dunst, Math.pow(i / 23, 1.5) * 0.8)));
    const dunstPix = pack(dunst);

    // Farben je Segment und Dunststufe vorberechnet (64 Stufen)
    const STUFEN = 64, BAENDER = 8;
    function stufen(hex) {
      const c = rgb(hex);
      return Array.from({ length: STUFEN }, (_, i) => pack(mische(c, dunst, i / (STUFEN - 1))));
    }
    const rand = F.randstein.map(stufen), linie = stufen(F.linie), ziel = F.ziel.map(stufen);
    // Gras in 16 Helligkeiten: ruhige Flecken (höchstens ±3 %) und zur Seite hin dunkler
    const GRAS_HELL = 16;
    const gras = F.gras.map((hex) => Array.from({ length: STUFEN }, (_, i) =>
      Array.from({ length: GRAS_HELL }, (_, k) => pack(mische(hell(rgb(hex), 0.66 + k * 0.026), dunst, i / (STUFEN - 1))))));
    function grasFleck(block, quer) {
      let h = (Math.imul(block, 73856093) ^ Math.imul(quer + 101, 19349663)) >>> 0;
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
      return ((h >>> 7) & 3) - 1.5;
    }
    // Asphalt mit leichtem Verlauf quer: zur Mitte etwas heller, zu den Rändern dunkler
    const strasse = F.strasse.map((hex) => Array.from({ length: STUFEN }, (_, i) =>
      Array.from({ length: BAENDER }, (_, b) => pack(mische(hell(rgb(hex), 1.07 - 0.16 * Math.pow(b / (BAENDER - 1), 2)), dunst, i / (STUFEN - 1))))));

    const sprites = [-1, 0, 1].map((n) => {
      const c = neueLeinwand(AUTO_B, AUTO_H);
      autoZeichnen(c.getContext("2d"), n);
      return c;
    });

    // Eine Bildschirmzeile Straße füllen
    function zeile(y, cx, w, s, seg, stufe) {
      const o = y * B;
      const feld = Math.floor(seg.nr / strecke.streifen) % 2;
      const gp = gras[feld][stufe];
      const block = Math.floor(seg.nr / 3);
      const rw = w * strecke.randstein;
      const links = cx - w, rechts = cx + w;
      const a0 = Math.max(0, Math.min(B, Math.round(links - rw)));
      const a1 = Math.max(0, Math.min(B, Math.round(links)));
      const b0 = Math.max(0, Math.min(B, Math.round(rechts)));
      const b1 = Math.max(0, Math.min(B, Math.round(rechts + rw)));
      // Gras: Flecken in Welt-Kacheln (3 Segmente lang, eine halbe Fahrbahn breit), nach außen dunkler
      const inv = 1 / w;
      for (let x = 0; x < B; x++) {
        if (x === a0) x = b1;
        if (x >= B) break;
        const u = (x + 0.5 - cx) * inv;
        const aussen = Math.min(1, (Math.abs(u) - 1) / 4);
        const k = Math.round(13 - 7 * aussen + 0.9 * grasFleck(block, Math.floor(u)));
        pix[o + x] = gp[k < 0 ? 0 : k > GRAS_HELL - 1 ? GRAS_HELL - 1 : k];
      }
      const rp = rand[feld][stufe];
      for (let x = a0; x < a1; x++) pix[o + x] = rp;
      for (let x = b0; x < b1; x++) pix[o + x] = rp;
      // Asphalt; Zielfeld als gedämpftes Schachbrett
      if (seg.nr < ZIEL_SEGMENTE) {
        const reihe = s < 0.5 ? 0 : 1;
        for (let x = a1; x < b0; x++) {
          const spalte = Math.floor(((x - links) / (2 * w)) * 14);
          pix[o + x] = ziel[(spalte + reihe + seg.nr) & 1][stufe];
        }
      } else {
        const bahn = strasse[Math.floor(seg.nr / 2) % 2][stufe];
        const invB = BAENDER / w;
        for (let x = a1; x < b0; x++) {
          const band = Math.min(BAENDER - 1, (Math.abs(x + 0.5 - cx) * invB) | 0);
          pix[o + x] = bahn[band];
        }
      }
      // Randlinien innen an den Randsteinen (mindestens ein Pixel, solange die Straße breit genug ist)
      if (w > 12) {
        const lb = Math.max(1, Math.round(w * 0.03));
        const lp = linie[stufe];
        if (links >= 0) for (let x = a1; x < Math.min(B, a1 + lb); x++) pix[o + x] = lp;
        if (rechts <= B) for (let x = Math.max(0, b0 - lb); x < b0; x++) pix[o + x] = lp;
      }
    }

    /*
     * Ein Bild zeichnen.
     * ansicht: { z, x, lenk, untergrund }
     *   z, x       Stelle und Querlage des eigenen Autos
     *   lenk       Lenkeinschlag -1..1 (Bild des Autos)
     */
    function zeichne(ansicht) {
      const laenge = strecke.laenge;
      const kamZ = (((ansicht.z - ABSTAND) % laenge) + laenge) % laenge;
      const basis = strecke.segment(kamZ);
      const anteil = (kamZ - basis.z1) / L;
      const kamY = KAMERA_HOEHE + strecke.hoeheBei(ansicht.z);
      const kamX = ansicht.x * strecke.breite;

      // Himmel und Berge nach der Fahrtrichtung, darunter Dunst
      const drehung = (strecke.richtungBei(ansicht.z) / (2 * Math.PI)) * PANORAMA;
      const versatzFern = (((Math.round(drehung - B / 2)) % PANORAMA) + PANORAMA) % PANORAMA;
      for (let y = 0; y < himmelH; y++) {
        const q = y * PANORAMA;
        const rest = PANORAMA - versatzFern;
        if (rest >= B) pix.set(himmel.subarray(q + versatzFern, q + versatzFern + B), y * B);
        else {
          pix.set(himmel.subarray(q + versatzFern, q + PANORAMA), y * B);
          pix.set(himmel.subarray(q, q + B - rest), y * B + rest);
        }
      }
      pix.fill(dunstPix, himmelH * B);
      // Nahe Hügel (volle Parallaxe)
      const versatzNah = (((Math.round(drehung * 1.25 - B / 2)) % PANORAMA) + PANORAMA) % PANORAMA;
      for (let x = 0; x < B; x++) {
        const h = huegel[(x + versatzNah) % PANORAMA];
        const kamm = Math.round(HORIZONT + 1 - 3 - Math.pow(h, 1.6) * 13);
        for (let y = Math.max(0, kamm); y < HORIZONT + 6; y++) pix[y * B + x] = huegelZeile[Math.min(23, y - kamm)];
      }

      // Straße von vorn nach hinten
      let maxY = H;
      let dx = -basis.kurve * anteil;
      let quer = 0;
      for (let n = 0; n < SICHT; n++) {
        const nr = basis.nr + n;
        const seg = strecke.segmente[nr % strecke.anzahl];
        const schleife = nr >= strecke.anzahl ? laenge : 0;
        const z1 = seg.z1 + schleife - kamZ, z2 = seg.z2 + schleife - kamZ;
        const qx1 = quer, qx2 = quer + dx;
        quer += dx;
        dx += seg.kurve;
        if (z1 <= TIEFE) continue;
        const s1 = TIEFE / z1, s2 = TIEFE / z2;
        const y1 = HORIZONT + s1 * (kamY - seg.y1) * (H / 2);
        const y2 = HORIZONT + s2 * (kamY - seg.y2) * (H / 2);
        if (y2 >= maxY || y2 >= y1) continue;
        const x1 = B / 2 + s1 * (qx1 - kamX) * (B / 2), x2 = B / 2 + s2 * (qx2 - kamX) * (B / 2);
        const w1 = s1 * strecke.breite * (B / 2), w2 = s2 * strecke.breite * (B / 2);
        const f = n / SICHT;
        const stufe = Math.min(STUFEN - 1, Math.round((1 - Math.exp(-f * f * NEBEL)) * (STUFEN - 1)));
        const oben = Math.max(0, Math.ceil(y2 - 0.5));
        const unten = Math.min(maxY, H, Math.ceil(y1 - 0.5));
        for (let y = oben; y < unten; y++) {
          const s = (y1 - (y + 0.5)) / (y1 - y2);
          zeile(y, x1 + (x2 - x1) * s, w1 + (w2 - w1) * s, s, seg, stufe);
        }
        if (oben < maxY) maxY = oben;
      }
      ctx.putImageData(bilddaten, 0, 0);

      // Eigenes Auto mit weichem Schatten nach links unten (wie der Beschlag der Werkstatt)
      // Die Straße unter dem Auto liegt immer auf derselben Zeile: Maßstab dort 1 / KAMERA_HOEHE
      const autoY = HORIZONT + H / 2 - AUTO_H + 2;
      const ruettel = ansicht.untergrund === "randstein" && Math.floor(ansicht.z / (L * 2)) % 2 ? 1 : 0;
      const ax = Math.round(B / 2 - AUTO_B / 2), ay = autoY - ruettel;
      ctx.save();
      ctx.fillStyle = "rgba(4, 3, 10, 0.32)";
      ctx.beginPath();
      ctx.ellipse(ax + AUTO_B / 2 - 3, ay + AUTO_H - 1, AUTO_B / 2 + 4, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(4, 3, 10, 0.38)";
      ctx.beginPath();
      ctx.ellipse(ax + AUTO_B / 2 - 2, ay + AUTO_H - 1, AUTO_B / 2 - 2, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const bildNr = ansicht.lenk < -0.3 ? 0 : ansicht.lenk > 0.3 ? 2 : 1;
      ctx.drawImage(sprites[bildNr], ax, ay);
    }

    return { bild, zeichne, sprites };
  }

  return { B, H, HORIZONT, KAMERA_HOEHE, TIEFE, ABSTAND, SICHT, erzeuge, autoZeichnen, AUTO_B, AUTO_H, rgb, mische };
});
