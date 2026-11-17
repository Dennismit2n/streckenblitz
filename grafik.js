/*
 * Streckenblitz: Pseudo-3D-Zeichner
 *
 * Das Spielbild entsteht in einem kleinen Bild von 427 × 240 Pixeln (16:9), das index.html
 * ganzzahlig und scharf vergrößert. Kleines Raster mit sichtbaren Pixeln, aber volle Farben:
 *  - Himmel als Verlauf (leicht gerastert, damit keine Stufen entstehen) mit Sonne, Mond oder
 *    Abendrot, ruhigen Sternen ohne Funkeln, je Strecke eigener Farbe.
 *  - Kulisse in drei bis vier Ebenen (Meer, Berge, Tafelberge, Gipfel, Stadt, Dünen, Waldkamm, Hügel),
 *    jede mit eigener Parallaxe in Kurven; mit den Hügeln der Straße rückt sie leicht auf und ab.
 *  - Straße aus Segmenten: Jedes Segment wird auf den Bildschirm projiziert, gezeichnet wird
 *    zeilenweise von vorn nach hinten. maxY merkt sich die höchste schon belegte Zeile, so
 *    verdecken Kuppen alles dahinter.
 *  - Dunst: Farben ferner Segmente laufen zur Nebelfarbe der Strecke.
 *  - Wechselstreifen (Randsteine, Gras, Asphalt) mit kleinem Helligkeitsunterschied, damit bei
 *    Tempo nichts flimmert.
 *  - Das eigene Auto ist ein Pixel-Sprite aus Code (drei Bilder: links, gerade, rechts).
 *  - Gegner: dasselbe Auto in ihrer Farbe mit Startnummer auf dem Heckflügel, in festen Größenstufen
 *    pixelgenau aus Code gezeichnet (keine verwaschene Skalierung), gegen Kuppen beschnitten,
 *    hinter der Kamera nicht gezeichnet.
 *  - Deko aus deko.js: nach Tiefe scharf skaliert (aus vorverkleinerten Stufen), eingedunstet,
 *    gegen Kuppen beschnitten, zusammen mit den Autos von hinten nach vorn gezeichnet.
 *  - Das „Neue“: weiche Schatten unter den Autos, weicher Lichtschein der Laternen (additiv,
 *    gedämpft, steht still), eine leichte Vignette. Kein Hitzeflimmern, nichts blinkt.
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

  // Farben eines Gegners aus seiner Grundfarbe; Helm, Reifen und Gold bleiben wie beim eigenen Auto
  function teamFarben(hex) {
    const c = rgb(hex);
    const ton = (f) => { const n = (1 << 24) | (Math.round(f[0]) << 16) | (Math.round(f[1]) << 8) | Math.round(f[2]); return "#" + n.toString(16).slice(1); };
    return Object.assign({}, AUTO_FARBEN, {
      karosse: hex,
      karosseSchatten: ton(hell(c, 0.8)),
      karosseHell: ton(mische(c, [224, 214, 196], 0.16)),
      karosseDunkel: ton(hell(c, 0.6)),
      karosseTief: ton(hell(c, 0.36)),
    });
  }

  // Ziffern 3 × 5 für die Startnummern (Bit 2 ist links)
  const ZIFFERN = [
    [7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 3, 1, 7], [5, 5, 7, 1, 1],
    [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 2, 2, 2], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7],
  ];
  const NUMMER_FARBE = "#cbbd98", NUMMER_GRUND = "#121117";

  // Sehhilfe Farbenblind: Gegnerfarben nach Okabe und Ito, je etwa 12 % dunkler (Nacht), in der Reihenfolge der Fahrer
  // in rennen.js (Grün, Blau, Weinrot, Purpur, Gold, Grau, Rostrot). Die Startnummern bleiben.
  const CVD_FARBEN = Object.freeze(["#008b65", "#00649d", "#bb5300", "#b46b93", "#d3c93a", "#4c9ecd", "#ca8c00"]);
  // Sehhilfe Hoher Kontrast: helle Randlinie und Kontur um jedes Auto (bleibt auch bei Hoher Kontrast hell so,
  // das Spielbild bleibt dunkel)
  const HC_LINIE = "#ece4cc", HC_KONTUR = "#ece4cc";

  /*
   * Zeichnet ein Auto in einen Canvas-Kontext.
   * neigung: -1 links, 0 gerade, 1 rechts; farben: Farbsatz; f: Größe (1 = 64 × 34 Pixel);
   * nummer: Startnummer auf beiden Hälften des Heckflügels (ab Größe 0,7 lesbar, sonst weggelassen).
   * Jedes Rechteck wird auf ganze Pixel der Zielgröße gerundet, so bleibt jede Größe pixelscharf.
   */
  function autoZeichnen(ctx, neigung, farben, f, nummer) {
    const F = farben || AUTO_FARBEN;
    const m = f || 1;
    const r = (x, y, b, h, farbe) => {
      const x0 = Math.round(x * m), y0 = Math.round(y * m), x1 = Math.round((x + b) * m), y1 = Math.round((y + h) * m);
      if (x1 > x0 && y1 > y0) { ctx.fillStyle = farbe; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    };
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

    // Startnummer: dunkles Schild mit hellen Ziffern, Ziffernpixel ganzzahlig (3 × 5 bleibt immer lesbar).
    // Groß links und rechts vom Helm, klein ein Schild mitten auf dem Flügel (verdeckt dann den Helm).
    if (nummer != null && m >= 0.4) {
      const k = Math.max(1, Math.floor(m + 0.8)); // Ziffernpixel: ab Größe 1,2 doppelt, ab 2,2 dreifach
      const text = String(nummer);
      const breit = text.length * 3 * k + (text.length - 1) * k;
      const gross = m >= 0.75;
      // klein: mindestens so breit wie der Helm (8 Einheiten plus Rand), oben bündig, damit nichts darüber hervorschaut
      const schildB = gross ? breit + 2 * k : Math.max(breit + 2 * k, Math.round(10 * m)), schildH = 7 * k;
      for (const mitte of gross ? [18, 46] : [32]) {
        const sx = Math.round((mitte + oben) * m - schildB / 2);
        const sy = gross ? Math.round(7.5 * m - schildH / 2) : 0;
        ctx.fillStyle = NUMMER_GRUND;
        ctx.fillRect(sx, sy, schildB, schildH);
        ctx.fillStyle = NUMMER_FARBE;
        for (let i = 0; i < text.length; i++) {
          const muster = ZIFFERN[text.charCodeAt(i) - 48];
          const zx = sx + Math.floor((schildB - breit) / 2) + i * 4 * k;
          for (let zy = 0; zy < 5; zy++) for (let b = 0; b < 3; b++) {
            if (muster[zy] & (4 >> b)) ctx.fillRect(zx + b * k, sy + k + zy * k, k, k);
          }
        }
      }
    }
  }

  // --- Zeichner ---------------------------------------------------------------

  // Größenstufen der Gegner: je 7 % größer, pixelgenau gezeichnet und beim Zeichnen nicht weiter skaliert
  const STUFE_MIN = 0.16, STUFE_SCHRITT = 1.07, STUFE_ANZAHL = 46;
  function stufeVon(f) {
    return Math.max(0, Math.min(STUFE_ANZAHL - 1, Math.round(Math.log(f / STUFE_MIN) / Math.log(STUFE_SCHRITT))));
  }

  // Kleiner Streuwert aus zwei ganzen Zahlen (für Fenster, Schnee, Krater), immer gleich
  function streu(a, b) {
    let h = (Math.imul(a, 73856093) ^ Math.imul(b + 101, 19349663)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
  }
  function zufallAus(samen) {
    let s = samen >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  const begrenze = (v, a, b) => (v < a ? a : v > b ? b : v);

  /*
   * fahrer: Liste der Gegner mit { farbe, nummer } (Index = nr in ansicht.gegner)
   */
  function erzeuge(strecke, neueLeinwand, fahrer) {
    const bild = neueLeinwand(B, H);
    const ctx = bild.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const bilddaten = ctx.createImageData(B, H);
    const pix = new Uint32Array(bilddaten.data.buffer);
    const F = strecke.farben;
    const KU = strecke.kulisse || {};
    const L = strecke.segmente[0].z2 - strecke.segmente[0].z1;
    const dunst = rgb(F.dunst);
    const sonne = rgb(F.sonne);
    const sonneX = ((((strecke.sonne || 0) / 360) * PANORAMA) % PANORAMA + PANORAMA) % PANORAMA;
    // Abstand zur Sonne (oder zum Mond) auf einer Bahn der Breite breite, deren Sonnenspalte bei sx liegt
    const abstandAuf = (x, sx, breite) => { let d = x - sx; if (d > breite / 2) d -= breite; if (d < -breite / 2) d += breite; return d; };

    // --- Himmel: Verlauf, Sterne, Milchstraße, Wolken, Sonne, Mond oder Abendrot ------------------
    // Die Himmelsbahn umfasst eine volle Umdrehung und dreht mit der Fahrtrichtung.
    const himmelH = HORIZONT + 8;
    const himmel = new Uint32Array(PANORAMA * himmelH);
    {
      const art = KU.himmelskoerper || "sonne";
      const sonneY = art === "mond" ? 36 : HORIZONT - 33, sonneR = art === "mond" ? 6 : 8;
      const wolken = KU.wolken === false ? null : rauschen(PANORAMA, 9, 4, 19);
      const wolke = rgb(F.wolke), wolkenKante = rgb(F.wolkenKante), stern = rgb(F.stern);
      const band = KU.milchstrasse ? rauschen(PANORAMA, 24, 4, 71) : null;
      const bandMitte = (x) => 24 + 20 * Math.sin((2 * Math.PI * x) / PANORAMA + 1.3);
      for (let y = 0; y < himmelH; y++) {
        const grund = verlauf(F.himmel, Math.min(1, y / HORIZONT));
        for (let x = 0; x < PANORAMA; x++) {
          let c = grund;
          const dx = abstandAuf(x, sonneX, PANORAMA);
          const naheSonne = Math.max(0, 1 - Math.abs(dx) / 420);
          // Milchstraße: ein sehr schwacher, ruhiger Schleier quer über den Himmel
          if (band) {
            const abst = Math.abs(y - bandMitte(x));
            if (abst < 16) c = mische(c, stern, 0.075 * Math.exp(-(abst / 7) * (abst / 7)) * (0.45 + 0.55 * band[x]) * Math.min(1, (HORIZONT - y) / 40));
          }
          // Wolkenstreifen: zwei flache Bänder, die Unterkante fängt das Restlicht
          if (wolken) {
            for (const [mitte, dicke, schwelle] of [[46, 3.2, 0.6], [60, 2.2, 0.64]]) {
              const dichte = (wolken[(x + mitte * 7) % PANORAMA] - schwelle) * 7;
              const halb = dicke * Math.min(1, Math.max(0, dichte));
              const dy = y - mitte;
              if (halb > 0.3 && Math.abs(dy) <= halb) {
                c = mische(c, wolke, 0.5 * Math.min(1, dichte) * (1 - 0.4 * Math.abs(dy) / (halb + 0.5)));
                if (dy > halb - 1) c = mische(c, wolkenKante, (0.25 + 0.5 * naheSonne) * Math.min(1, dichte));
              }
            }
          }
          const d = Math.hypot(dx, (y - sonneY) * 1.1);
          if (art === "sonne") {
            // gedämpfte Scheibe mit weichem Schein, keine helle Fläche
            if (d < sonneR) c = mische(c, sonne, 0.9 - 0.25 * (d / sonneR) * (d / sonneR));
            else if (d < 80) c = mische(c, sonne, 0.24 * Math.pow(1 - d / 80, 2.4));
          } else if (art === "mond") {
            // Mondscheibe mit dunkleren Flecken, kleiner Hof
            if (d < sonneR) {
              const fleck = streu(Math.round(dx + 20), y) < 0.3 || (Math.abs(dx + 2) < 2 && Math.abs(y - sonneY + 1) < 2) ? 0.2 : 0;
              c = mische(c, sonne, 0.86 - fleck - 0.2 * (d / sonneR) * (d / sonneR));
            } else if (d < 48) c = mische(c, sonne, 0.11 * Math.pow(1 - d / 48, 2));
          } else {
            // Abendrot: die Sonne ist hinter den Bergen, ihr Schein liegt breit über dem Horizont
            const tief = Math.max(0, (y - 30) / (HORIZONT - 30));
            const breit = Math.max(0, 1 - Math.abs(dx) / 360);
            c = mische(c, sonne, 0.42 * breit * breit * tief * tief);
          }
          himmel[y * PANORAMA + x] = packRaster(c, x, y);
        }
      }
      // Sterne: ruhig, ohne Funkeln, nach unten hin seltener und schwächer
      const zufall = zufallAus(977);
      const stern1 = (x, y, staerke) => {
        if (y < 0 || y >= himmelH) return;
        himmel[y * PANORAMA + x] = pack(mische(verlauf(F.himmel, y / HORIZONT), stern, staerke));
      };
      const anzahl = KU.sterne == null ? 150 : KU.sterne;
      const sperre = art === "sonne" ? 90 : art === "mond" ? 22 : 0;
      for (let i = 0; i < anzahl; i++) {
        const x = Math.floor(zufall() * PANORAMA), y = Math.floor(Math.pow(zufall(), 1.5) * 70);
        const staerke = (0.16 + 0.42 * zufall()) * Math.max(0, 1 - y / 78);
        if (Math.abs(abstandAuf(x, sonneX, PANORAMA)) < sperre && Math.abs(y - sonneY) < sperre) continue;
        stern1(x, y, staerke);
      }
      // Milchstraße: dichter, aber schwächer gestreut
      if (band) {
        for (let i = 0; i < 520; i++) {
          const x = Math.floor(zufall() * PANORAMA);
          const y = Math.round(bandMitte(x) + (zufall() + zufall() + zufall() - 1.5) * 9);
          if (Math.abs(abstandAuf(x, sonneX, PANORAMA)) < sperre && Math.abs(y - sonneY) < sperre) continue;
          stern1(x, y, (0.08 + 0.2 * zufall()) * Math.max(0, 1 - y / 78));
        }
      }
    }

    // --- Kulisse: bis zu vier Ebenen mit eigener Parallaxe --------------------------------------
    // Jede Ebene ist eine Bahn der Breite PANORAMA · fx: Nach einer vollen Umdrehung steht sie wieder genau gleich.
    // kamm[x] ist die oberste belegte Zeile, darunter ist die Ebene dicht bis UNTEN (die Kulisse rückt mit Hügeln auf und ab).
    const UNTEN = HORIZONT + 18;
    function ebene(fx, fy, hoehe, farbe) {
      const P = Math.round(PANORAMA * fx);
      const kamm = new Int16Array(P);
      let oben = UNTEN;
      for (let x = 0; x < P; x++) {
        const k = Math.round(hoehe(x, P));
        kamm[x] = Math.min(UNTEN, Math.max(0, k));
        oben = Math.min(oben, kamm[x]);
      }
      const daten = new Uint32Array(P * (UNTEN - oben));
      for (let x = 0; x < P; x++) {
        for (let y = kamm[x]; y < UNTEN; y++) daten[(y - oben) * P + x] = packRaster(farbe(x, y, kamm[x], P, kamm), x, y);
      }
      return { fx, fy, P, kamm, oben, daten };
    }
    const ebenen = [];
    const sonneIn = (x, P) => abstandAuf(x, (sonneX * P) / PANORAMA, P);
    const himmelBei = (y) => verlauf(F.himmel, Math.min(1, Math.max(0, y) / HORIZONT));
    const tiefe = (y, k, spanne) => Math.min(1, (y - k) / spanne);
    const ART = KU.fern || "berge";

    // Meer: offener Horizont unter der Sonne, ruhiger Lichtweg aus Strichen (steht still)
    if (KU.meer) {
      const meer = rgb(F.meer);
      ebenen.push(ebene(1, 0.5, () => HORIZONT - 3, (x, y, k) => {
        const dx = sonneIn(x, PANORAMA);
        let c = mische(meer, dunst, 0.2 + 0.6 * tiefe(y, k, 20));
        if (y === k) c = mische(c, sonne, 0.1 + 0.3 * Math.max(0, 1 - Math.abs(dx) / 200));
        const weg = 1.5 + (y - k) * 1.1;
        if (Math.abs(dx) < weg && (y + Math.floor((dx + 40) / 3)) % 2 === 0) c = mische(c, sonne, 0.32 * (1 - Math.abs(dx) / weg) * (1 - tiefe(y, k, 22)));
        return c;
      }));
    }
    // Ferne Ebene
    if (ART === "berge") {
      const roh = rauschen(PANORAMA, 7, 6, 7), bergFarbe = rgb(F.berge);
      ebenen.push(ebene(1, 0.5, (x) => {
        const dx = Math.abs(sonneIn(x, PANORAMA));
        // unter der Sonne öffnet sich der Kamm zum Meer (ohne Meer: ein Sattel, die Sonne steht frei)
        const sattel = KU.meer ? Math.min(1, Math.max(0, (dx - 70) / 220)) : 0.45 + 0.55 * Math.min(1, dx / 110);
        if (sattel <= 0.02) return UNTEN;
        return HORIZONT - 4 - (0.15 + 0.85 * (1 - Math.abs(2 * roh[x] - 1))) * 22 * sattel + (KU.meer ? (1 - sattel) * 6 : 0);
      }, (x, y, k) => {
        const naheSonne = Math.max(0, 1 - Math.abs(sonneIn(x, PANORAMA)) / 420);
        let c = mische(mische(bergFarbe, dunst, 0.12 + 0.55 * tiefe(y, k, 26)), himmelBei(y), 0.1);
        if (y === k) c = mische(c, sonne, 0.1 + 0.4 * naheSonne);
        return c;
      }));
    } else if (ART === "tafelberge") {
      // Tafelberge: flache Kuppen mit steilen Flanken, Schichten, Mondlicht auf der Kante
      const grat = rauschen(PANORAMA, 12, 3, 41), bergFarbe = rgb(F.berge);
      const z = zufallAus(43), tafeln = [];
      for (let i = 0; i < 7; i++) tafeln.push({ c: z() * PANORAMA, b: 50 + z() * 110, h: 12 + z() * 16, flanke: 9 + z() * 10 });
      // steile Flanken, oben fast eben mit leichten Buckeln
      const hoeheBei = (x) => {
        let h = 2 + grat[x] * 4;
        for (const t of tafeln) {
          const d = Math.abs(abstandAuf(x, t.c, PANORAMA));
          if (d >= t.b / 2) continue;
          const rand = (t.b / 2 - d) / t.flanke;
          const oben = t.h + 1.6 * Math.sin(x * 0.11 + t.c) + (grat[x] - 0.5) * 2.5;
          h = Math.max(h, (rand < 1 ? Math.pow(rand, 0.75) : 1) * oben);
        }
        return h;
      };
      ebenen.push(ebene(1, 0.5, (x) => HORIZONT - 2 - hoeheBei(x), (x, y, k) => {
        const naheMond = Math.max(0, 1 - Math.abs(sonneIn(x, PANORAMA)) / 500);
        let c = mische(bergFarbe, dunst, 0.12 + 0.5 * tiefe(y, k, 22));
        if ((y - k) % 6 === 4 && y < HORIZONT) c = hell(c, 0.93);
        if (y === k) c = mische(c, sonne, 0.1 + 0.16 * naheMond);
        return c;
      }));
    } else if (ART === "gipfel") {
      // Hohe, zackige Gipfel: Schnee nur gedämpft, Abendrot auf den Graten
      const roh = rauschen(PANORAMA, 6, 7, 53), bergFarbe = rgb(F.berge), schnee = rgb(F.schnee);
      const spitze = (x) => Math.pow(1 - Math.abs(2 * roh[x] - 1), 1.4);
      ebenen.push(ebene(1, 0.5, (x) => HORIZONT - 6 - (0.1 + 0.9 * spitze(x)) * 36, (x, y, k, P, kamm) => {
        const naheSonne = Math.max(0, 1 - Math.abs(sonneIn(x, P)) / 380);
        let c = mische(bergFarbe, dunst, 0.1 + 0.55 * tiefe(y, k, 40));
        const s = spitze(x);
        const schneeTiefe = (s - 0.5) * 28 * (0.6 + 0.4 * streu(x, 3));
        if (y - k < schneeTiefe && streu(x, y) < 0.88) c = mische(c, schnee, 0.5 * (1 - (y - k) / schneeTiefe));
        // Flanken, die nach links schauen, fangen das Restlicht
        const hang = kamm[(x + 1) % P] - kamm[(x + P - 1) % P];
        if (hang > 0 && y - k < 10) c = mische(c, sonne, 0.06 * Math.min(1, hang / 2) * (1 - (y - k) / 10));
        if (y - k < 1) c = mische(c, sonne, 0.16 + 0.34 * naheSonne);
        return c;
      }));
    }
    // Mittlere Ebene
    if (KU.mitte === "stadt") {
      // Hafenstadt: Häuser, ein Turm, wenige warme Fenster, die ruhig leuchten
      const P = Math.round(PANORAMA * 1.1), mitte = Math.round(P * 0.33), halb = 150;
      const stadt = rgb(F.stadt), fenster = rgb(F.fenster);
      const hoehen = new Float32Array(P).fill(-1), giebel = new Uint8Array(P);
      const z = zufallAus(59);
      for (let x = mitte - halb; x < mitte + halb;) {
        const b = 3 + Math.floor(z() * 8);
        const huelle = 1 - Math.pow((x - mitte) / halb, 2);
        const h = 2 + (z() * 9 + 3) * huelle;
        const dach = z() < 0.4;
        for (let i = 0; i < b; i++) {
          const xx = ((x + i) % P + P) % P;
          hoehen[xx] = h + (dach ? Math.min(i, b - 1 - i) * 0.8 : 0);
          giebel[xx] = i === 0 || i === b - 1 ? 1 : 0;
        }
        x += b + (z() < 0.2 ? 2 : 0);
      }
      for (let i = -1; i <= 1; i++) hoehen[mitte + 20 + i] = 21 - Math.abs(i) * 5; // Kirchturm
      ebenen.push(ebene(1.1, 0.7, (x) => (hoehen[x] < 0 ? UNTEN : HORIZONT - 1 - hoehen[x]), (x, y, k) => {
        let c = mische(stadt, dunst, 0.22 + 0.45 * tiefe(y, k, 14));
        if (y === k) c = mische(c, sonne, 0.12);
        else if (y > k + 1 && y < HORIZONT && !giebel[x] && streu(x, y) < 0.075) c = mische(fenster, dunst, 0.38);
        return c;
      }));
    } else if (KU.mitte === "duenen" || KU.mitte === "waldkamm") {
      const P = Math.round(PANORAMA * 1.12);
      if (KU.mitte === "duenen") {
        const farbe = rgb(F.duenen);
        const phasen = [0.3, 2.1, 4.4, 1.2];
        const h = (x) => {
          const t = (2 * Math.PI * x) / P;
          const v = 0.4 * Math.sin(3 * t + phasen[0]) + 0.3 * Math.sin(5 * t + phasen[1]) + 0.2 * Math.sin(9 * t + phasen[2]) + 0.1 * Math.sin(14 * t + phasen[3]);
          return Math.pow((v + 1) / 2, 1.4) * 11;
        };
        ebenen.push(ebene(1.12, 0.75, (x) => HORIZONT - 1 - h(x), (x, y, k, P2, kamm) => {
          let c = mische(farbe, dunst, 0.25 + 0.45 * tiefe(y, k, 16));
          const hang = kamm[(x + 1) % P2] - kamm[(x + P2 - 1) % P2];
          c = hang < 0 ? mische(c, sonne, 0.07 * Math.min(1, -hang)) : hell(c, 1 - 0.06 * Math.min(1, hang));
          if (y === k) c = mische(c, sonne, 0.12);
          return c;
        }));
      } else {
        const wald = rgb(F.wald), grat = rauschen(P, 9, 4, 61);
        const spitzen = new Float32Array(P).fill(0), z = zufallAus(67);
        for (let x = 0; x < P;) {
          const th = 3 + z() * 5, hb = th * 0.34;
          for (let i = -Math.ceil(hb); i <= Math.ceil(hb); i++) {
            const xx = (x + i + P) % P;
            spitzen[xx] = Math.max(spitzen[xx], th * (1 - Math.abs(i) / (hb + 0.5)));
          }
          x += 2 + Math.floor(z() * 3);
        }
        ebenen.push(ebene(1.12, 0.75, (x) => HORIZONT - 5 - grat[x] * 9 - spitzen[x], (x, y, k) => {
          let c = mische(wald, dunst, 0.3 + 0.45 * tiefe(y, k, 16));
          if (y === k && streu(x, 9) < 0.5) c = mische(c, sonne, 0.1);
          return c;
        }));
      }
    }
    // Nahe Ebene
    {
      const nah = KU.nah || "huegel", farbe = rgb(F.huegel), P = Math.round(PANORAMA * 1.25);
      const rohH = rauschen(P, 10, 4, 31);
      if (nah === "huegel") {
        // Am Meer sind die Hügel unter der Sonne flach, damit der Horizont frei bleibt
        ebenen.push(ebene(1.25, 1, (x) => {
          const offen = KU.meer ? Math.min(1, Math.max(0.15, (Math.abs(sonneIn(x, P)) - 120) / 260)) : 1;
          return HORIZONT - 2 - Math.pow(rohH[x], 1.6) * 13 * offen;
        }, (x, y, k) => mische(farbe, dunst, Math.pow(Math.min(1, (y - k) / 23), 1.5) * 0.8)));
      } else if (nah === "duenenNah") {
        ebenen.push(ebene(1.25, 1, (x) => HORIZONT - 1 - Math.pow(rohH[x], 1.3) * 12, (x, y, k, P2, kamm) => {
          let c = mische(farbe, dunst, Math.pow(Math.min(1, (y - k) / 22), 1.4) * 0.75);
          const hang = kamm[(x + 1) % P2] - kamm[(x + P2 - 1) % P2];
          if (hang < 0 && y - k < 6) c = mische(c, sonne, 0.06);
          if (y === k) c = mische(c, sonne, 0.1);
          return c;
        }));
      } else {
        const spitzen = new Float32Array(P).fill(0), z = zufallAus(71);
        for (let x = 0; x < P;) {
          const th = 6 + z() * 8, hb = th * 0.32;
          for (let i = -Math.ceil(hb); i <= Math.ceil(hb); i++) {
            const xx = (x + i + P) % P;
            spitzen[xx] = Math.max(spitzen[xx], th * (1 - Math.abs(i) / (hb + 0.5)));
          }
          x += 3 + Math.floor(z() * 4);
        }
        ebenen.push(ebene(1.25, 1, (x) => HORIZONT - 2 - Math.pow(rohH[x], 1.4) * 9 - spitzen[x], (x, y, k) => {
          let c = mische(farbe, dunst, Math.pow(Math.min(1, (y - k) / 26), 1.4) * 0.7);
          if (y === k && streu(x, 13) < 0.4) c = mische(c, sonne, 0.09);
          return c;
        }));
      }
    }
    const dunstPix = pack(dunst);

    // --- Straße: Farben je Segment und Dunststufe vorberechnet (64 Stufen) ----------------------
    const STUFEN = 64, BAENDER = 8;
    // höchstens: so weit geht der Dunst (1 = ganz in der Ferne verschwunden)
    function stufen(hex, hoechstens) {
      const c = typeof hex === "string" ? rgb(hex) : hex;
      const h = hoechstens == null ? 1 : hoechstens;
      return Array.from({ length: STUFEN }, (_, i) => pack(mische(c, dunst, (h * i) / (STUFEN - 1))));
    }
    const ziel = F.ziel.map(stufen);
    let rand = null, linie = null, hoherKontrast = false;
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
    const nebelBei = (n) => Math.min(STUFEN - 1, Math.round((1 - Math.exp(-(n / SICHT) * (n / SICHT) * NEBEL)) * (STUFEN - 1)));

    // Hoher Kontrast: ein Pixel helle Kontur rund um das Bild eines Autos (das Bild wird 2 Pixel größer)
    function mitKontur(quelle) {
      if (!hoherKontrast) return quelle;
      const riss = neueLeinwand(quelle.width, quelle.height), rg = riss.getContext("2d");
      rg.drawImage(quelle, 0, 0);
      rg.globalCompositeOperation = "source-in";
      rg.fillStyle = HC_KONTUR;
      rg.fillRect(0, 0, quelle.width, quelle.height);
      const c = neueLeinwand(quelle.width + 2, quelle.height + 2), g = c.getContext("2d");
      for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) g.drawImage(riss, dx, dy);
      g.drawImage(quelle, 1, 1);
      c.f = quelle.f;
      return c;
    }

    // Gegner-Bilder entstehen erst, wenn eine Größe gebraucht wird
    let sprites = null, gegnerFarben = null;
    const gegnerSpeicher = new Map();
    function gegnerBild(nr, neigung, stufe) {
      const schluessel = nr * 1000 + stufe * 4 + neigung + 1;
      let c = gegnerSpeicher.get(schluessel);
      if (!c) {
        const f = STUFE_MIN * Math.pow(STUFE_SCHRITT, stufe);
        c = neueLeinwand(Math.max(1, Math.round(AUTO_B * f)), Math.max(1, Math.round(AUTO_H * f)));
        autoZeichnen(c.getContext("2d"), neigung, gegnerFarben[nr], f, fahrer[nr].nummer);
        c.f = f;
        c = mitKontur(c);
        gegnerSpeicher.set(schluessel, c);
      }
      return c;
    }

    /*
     * Sehhilfe für das Spielbild (dieselben Namen wie die Seite): normal, hc-dunkel, hc-hell, farbenblind, umkehr.
     * Hoher Kontrast: Randsteine einfarbig (kein Wechsel, also auch kein Flimmern), helle und breitere Randlinie,
     * die im Dunst höchstens zur Hälfte verschwindet, helle Kontur um alle Autos. Farbenblind: Gegnerfarben nach
     * Okabe und Ito. Umkehr dreht die Seite per CSS, hier ändert sich nichts.
     */
    let modus = "";
    function setzeModus(neu) {
      if (neu === modus) return;
      modus = neu;
      hoherKontrast = modus === "hc-dunkel" || modus === "hc-hell";
      if (hoherKontrast) {
        const mitte = hell(mische(rgb(F.randstein[0]), rgb(F.randstein[1]), 0.5), 0.85);
        const r = stufen(mitte);
        rand = [r, r];
        linie = stufen(HC_LINIE, 0.5);
      } else {
        rand = F.randstein.map((h) => stufen(h));
        linie = stufen(F.linie);
      }
      sprites = [-1, 0, 1].map((n) => {
        const c = neueLeinwand(AUTO_B, AUTO_H);
        autoZeichnen(c.getContext("2d"), n);
        return mitKontur(c);
      });
      gegnerFarben = (modus === "farbenblind" ? CVD_FARBEN : (fahrer || []).map((g) => g.farbe)).map(teamFarben);
      gegnerSpeicher.clear();
    }
    setzeModus("normal");

    // --- Weiche Lichter und Schatten (glatte Verläufe, das einzig „Neue“ zwischen den Pixeln) -------
    function scheibe(groesse, farbe, stopps) {
      const c = neueLeinwand(groesse, groesse), g = c.getContext("2d");
      const v = g.createRadialGradient(groesse / 2, groesse / 2, 0, groesse / 2, groesse / 2, groesse / 2);
      const [r, gr, b] = rgb(farbe);
      for (const [t, a] of stopps) v.addColorStop(t, "rgba(" + r + "," + gr + "," + b + "," + a + ")");
      g.fillStyle = v;
      g.fillRect(0, 0, groesse, groesse);
      return c;
    }
    const schein = scheibe(64, F.deko ? F.deko.schein : "#a06e3e", [[0, 1], [0.22, 0.55], [0.55, 0.16], [1, 0]]);
    const schatten = scheibe(64, "#04030a", [[0, 0.62], [0.5, 0.4], [0.8, 0.12], [1, 0]]);
    // Leichte Vignette: die Ecken etwas dunkler, die Mitte unberührt
    const vignette = neueLeinwand(B, H);
    {
      const g = vignette.getContext("2d");
      const v = g.createRadialGradient(B / 2, H * 0.46, B * 0.3, B / 2, H * 0.46, B * 0.72);
      v.addColorStop(0, "rgba(3, 2, 9, 0)");
      v.addColorStop(1, "rgba(3, 2, 9, 0.42)");
      g.fillStyle = v;
      g.fillRect(0, 0, B, H);
    }
    // Weicher Schatten auf dem Boden (Mitte cx, Unterkante y, Breite b)
    function bodenSchatten(cx, y, b, h) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(schatten, Math.round(cx - b / 2), Math.round(y - h / 2), Math.round(b), Math.max(2, Math.round(h)));
      ctx.imageSmoothingEnabled = false;
    }

    // --- Deko-Bilder: einmal gemalt, gespiegelt, in halben Größen vorgerechnet, mit Dunst-Schattenriss --
    const D = typeof Deko !== "undefined" ? Deko : null;
    const artSpeicher = new Map();
    function artBild(art, variante, spiegel) {
      const schluessel = art + ":" + variante + ":" + (spiegel ? 1 : 0);
      let a = artSpeicher.get(schluessel);
      if (a) return a;
      const roh = D.malen(art, variante, F.deko, neueLeinwand);
      let basis = roh.bild, fussX = roh.fussX, lichter = roh.lichter;
      if (spiegel) {
        const c = neueLeinwand(roh.b, roh.h), g = c.getContext("2d");
        g.translate(roh.b, 0);
        g.scale(-1, 1);
        g.drawImage(roh.bild, 0, 0);
        basis = c;
        fussX = roh.b - fussX;
        lichter = lichter.map((l) => Object.assign({}, l, { x: roh.b - l.x }));
      }
      // Stufen: volle Größe, dann jeweils halb so groß (geglättet verkleinert, danach wird nur noch scharf skaliert)
      const stufenListe = [];
      let akt = basis;
      for (;;) {
        const silh = neueLeinwand(akt.width, akt.height), g = silh.getContext("2d");
        g.drawImage(akt, 0, 0);
        g.globalCompositeOperation = "source-in";
        g.fillStyle = F.dunst;
        g.fillRect(0, 0, akt.width, akt.height);
        stufenListe.push({ bild: akt, silh });
        if (akt.width < 6 || akt.height < 6) break;
        const k = neueLeinwand(Math.ceil(akt.width / 2), Math.ceil(akt.height / 2)), kg = k.getContext("2d");
        kg.imageSmoothingEnabled = true;
        kg.imageSmoothingQuality = "high";
        kg.drawImage(akt, 0, 0, k.width, k.height);
        akt = k;
      }
      a = { b: roh.b, h: roh.h, fussX, lichter, stufen: stufenListe };
      artSpeicher.set(schluessel, a);
      return a;
    }
    // Deko je Segment (ohne unsichtbare Pfeiler), Spielart aus der Stelle
    const dekoJeSeg = Array.from({ length: strecke.anzahl }, () => null);
    if (D && strecke.deko) {
      for (const d of strecke.deko) {
        if (d.unsichtbar) continue;
        const n = D.VARIANTEN[d.art] || 1;
        const eintrag = { d, variante: (d.seg * 7 + Math.round(Math.abs(d.x) * 13)) % n };
        (dekoJeSeg[d.seg] || (dekoJeSeg[d.seg] = [])).push(eintrag);
      }
    }

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
      // Hoher Kontrast: schon ab kleinerer Breite und doppelt so breit (nah mindestens 2 Pixel)
      if (w > (hoherKontrast ? 5 : 12)) {
        const lb = hoherKontrast ? (w > 20 ? Math.max(2, Math.round(w * 0.06)) : 1) : Math.max(1, Math.round(w * 0.03));
        const lp = linie[stufe];
        if (links >= 0) for (let x = a1; x < Math.min(B, a1 + lb); x++) pix[o + x] = lp;
        if (rechts <= B) for (let x = Math.max(0, b0 - lb); x < b0; x++) pix[o + x] = lp;
      }
    }

    // Je Segment der Sicht: Querversatz am Anfang, Zuwachs und die erste schon belegte Zeile (für Sprites)
    const segQuer = new Float64Array(SICHT), segDx = new Float64Array(SICHT), segFrei = new Float64Array(SICHT);

    /*
     * Ein Bild zeichnen.
     * ansicht: { z, x, lenk, untergrund, gegner }
     *   z, x       Stelle und Querlage des eigenen Autos
     *   lenk       Lenkeinschlag -1..1 (Bild des Autos)
     *   gegner     [{ z, x, lenk, nr }] andere Autos (nr: Index in fahrer)
     */
    function zeichne(ansicht) {
      const laenge = strecke.laenge;
      const kamZ = (((ansicht.z - ABSTAND) % laenge) + laenge) % laenge;
      const basis = strecke.segment(kamZ);
      const anteil = (kamZ - basis.z1) / L;
      const kamY = KAMERA_HOEHE + strecke.hoeheBei(ansicht.z);
      // Die Kamera folgt der Straße: Der Querversatz der Kurven an der Stelle des Autos wird ausgeglichen.
      // So steht das eigene Auto in der Bildmitte genau dort, wo die Physik es führt (wichtig neben Gegnern).
      let querAuto = 0;
      {
        let q = 0, d = -basis.kurve * anteil;
        const ziel = ABSTAND + anteil * L;
        for (let n = 0; n * L < ziel; n++) {
          querAuto = q + d * Math.min(1, (ziel - n * L) / L);
          q += d;
          d += strecke.segmente[(basis.nr + n) % strecke.anzahl].kurve;
        }
      }
      const kamX = ansicht.x * strecke.breite + querAuto;

      // Himmel nach der Fahrtrichtung, darunter Dunst
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
      // Kulisse: Ebenen mit Parallaxe. Liegt die Straße weiter vorn höher, rückt die Kulisse hoch, hinter Kuppen sinkt sie.
      const hier = strecke.hoeheBei(ansicht.z);
      const fern = (strecke.hoeheBei(ansicht.z + 20000) + strecke.hoeheBei(ansicht.z + 30000) + strecke.hoeheBei(ansicht.z + 40000)) / 3;
      const hub = begrenze((hier - fern) * 0.0026, -9, 9);
      for (const e of ebenen) {
        const vx = (((Math.round(drehung * e.fx - B / 2)) % e.P) + e.P) % e.P;
        const dy = Math.round(hub * e.fy);
        for (let x = 0; x < B; x++) {
          const p = (x + vx) % e.P;
          const k = e.kamm[p];
          for (let y = k; y < UNTEN; y++) {
            const Y = y + dy;
            if (Y >= 0 && Y < H) pix[Y * B + x] = e.daten[(y - e.oben) * e.P + p];
          }
        }
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
        segQuer[n] = quer;
        segDx[n] = dx;
        segFrei[n] = maxY;
        quer += dx;
        dx += seg.kurve;
        if (z1 <= TIEFE) continue;
        const s1 = TIEFE / z1, s2 = TIEFE / z2;
        const y1 = HORIZONT + s1 * (kamY - seg.y1) * (H / 2);
        const y2 = HORIZONT + s2 * (kamY - seg.y2) * (H / 2);
        if (y2 >= maxY || y2 >= y1) continue;
        const x1 = B / 2 + s1 * (qx1 - kamX) * (B / 2), x2 = B / 2 + s2 * (qx2 - kamX) * (B / 2);
        const w1 = s1 * strecke.breite * (B / 2), w2 = s2 * strecke.breite * (B / 2);
        const stufe = nebelBei(n);
        const oben = Math.max(0, Math.ceil(y2 - 0.5));
        const unten = Math.min(maxY, H, Math.ceil(y1 - 0.5));
        for (let y = oben; y < unten; y++) {
          const s = (y1 - (y + 0.5)) / (y1 - y2);
          zeile(y, x1 + (x2 - x1) * s, w1 + (w2 - w1) * s, s, seg, stufe);
        }
        if (oben < maxY) maxY = oben;
      }
      ctx.putImageData(bilddaten, 0, 0);

      // Deko, Gegner und das eigene Auto von hinten nach vorn
      const liste = [];
      for (let n = 0; n < SICHT - 2; n++) {
        const eintraege = dekoJeSeg[(basis.nr + n) % strecke.anzahl];
        if (!eintraege) continue;
        for (const e of eintraege) {
          const zr = n * L + (e.d.z - strecke.segmente[(basis.nr + n) % strecke.anzahl].z1) - anteil * L;
          if (zr < ABSTAND * 0.25) continue; // unter oder hinter der Kamera
          liste.push({ zr, n, e });
        }
      }
      for (const g of ansicht.gegner || []) {
        const zr = (((g.z - kamZ) % laenge) + laenge) % laenge;
        if (zr < ABSTAND * 0.3 || zr > (SICHT - 2) * L) continue; // hinter oder unter der Kamera, oder zu weit weg
        liste.push({ zr, g });
      }
      liste.push({ zr: ABSTAND, ich: true });
      liste.sort((a, b) => b.zr - a.zr);
      for (const t of liste) {
        if (t.e) dekoZeichnen(t.e, t.zr, t.n, anteil, kamX, kamY);
        else if (t.g) gegnerZeichnen(t.g, t.zr, anteil, kamX, kamY);
        else eigenesAuto(ansicht);
      }
      ctx.drawImage(vignette, 0, 0);
    }

    // Ein Bild beschnitten zeichnen: nur die Zeilen oberhalb von frei (Kuppen verdecken den Rest)
    function beschnitten(quelle, x0, y0, x1, y1, frei) {
      if (y0 >= frei || x1 <= x0 || y1 <= y0) return;
      const sichtbar = Math.min(y1, frei) - y0;
      ctx.drawImage(quelle, 0, 0, quelle.width, (quelle.height * sichtbar) / (y1 - y0), x0, y0, x1 - x0, sichtbar);
    }

    function dekoZeichnen(e, zr, n, anteil, kamX, kamY) {
      const d = e.d;
      const s = TIEFE / zr;
      const t = zr / L + anteil - n;
      const quer = segQuer[n] + segDx[n] * t;
      const boden = strecke.hoeheBei(d.z);
      const yBoden = HORIZONT + s * (kamY - boden) * (H / 2);
      const jeEinheit = s * (B / 2);
      const xBoden = B / 2 + (quer + d.x * strecke.breite - kamX) * jeEinheit;
      const a = artBild(d.art, e.variante, d.spiegel);
      const k = jeEinheit * D.KUNST; // Bildschirmpixel je Bildpixel
      const dw = a.b * k, dh = a.h * k;
      if (dh < 1.5) return;
      const left = xBoden - a.fussX * k, top = yBoden - dh;
      if (left > B || left + dw < 0 || top >= H) return;
      const frei = Math.min(H, segFrei[n]);
      if (top >= frei) return;
      const nebel = nebelBei(n) / (STUFEN - 1);
      // Lichtfleck der Laterne auf dem Boden, vor dem Mast
      for (const l of a.lichter) {
        if (!l.boden) continue;
        const rx = 900 * jeEinheit, ry = rx * Math.min(0.6, (0.562 * (kamY - boden)) / zr);
        const cx = left + l.x * k;
        if (yBoden - ry >= frei) continue;
        lichtZeichnen(cx, yBoden, rx, ry, 0.15 * (1 - nebel), frei);
      }
      // passende Größenstufe: die kleinste, die noch mindestens so breit ist wie das Ziel
      let st = a.stufen[0];
      for (const kandidat of a.stufen) { if (kandidat.bild.width >= dw * 0.98) st = kandidat; else break; }
      const x0 = Math.round(left), x1 = Math.round(left + dw), y0 = Math.round(top), y1 = Math.round(yBoden);
      beschnitten(st.bild, x0, y0, x1, y1, frei);
      if (nebel > 0.01) {
        ctx.globalAlpha = nebel;
        beschnitten(st.silh, x0, y0, x1, y1, frei);
        ctx.globalAlpha = 1;
      }
      for (const l of a.lichter) {
        const r = l.r * jeEinheit;
        if (r < 0.8) continue;
        const ly = top + l.y * k;
        if (ly >= frei) continue;
        lichtZeichnen(left + l.x * k, ly, r, r, l.staerke * (1 - 0.85 * nebel), frei);
      }
    }

    // Weicher, gedämpfter Lichtschein (additiv), gegen Kuppen beschnitten
    function lichtZeichnen(cx, cy, rx, ry, staerke, frei) {
      if (staerke <= 0.005) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, B, frei);
      ctx.clip();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(1, staerke);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(schein, cx - rx, cy - ry, 2 * rx, 2 * ry);
      ctx.restore();
    }

    function gegnerZeichnen(g, zr, anteil, kamX, kamY) {
      const pos = zr / L + anteil;
      const n = Math.floor(pos), t = pos - n;
      const s = TIEFE / zr;
      const quer = segQuer[n] + segDx[n] * t;
      const y = HORIZONT + s * (kamY - strecke.hoeheBei(g.z)) * (H / 2);
      const x = B / 2 + s * (quer + g.x * strecke.breite - kamX) * (B / 2);
      const frei = Math.min(H, segFrei[n]); // Zeilen ab hier gehören schon näherer Straße (Kuppe)
      const bild = gegnerBild(g.nr, g.lenk < -0.3 ? -1 : g.lenk > 0.3 ? 1 : 0, stufeVon(s * KAMERA_HOEHE));
      const f = bild.f;
      const unten = Math.round(y + 2 * f);
      if (unten - bild.height >= frei) return; // ganz hinter der Kuppe
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, B, frei);
      ctx.clip();
      bodenSchatten(Math.round(x) - 3 * f, unten - f, (AUTO_B + 14) * f, Math.max(2, 11 * f));
      ctx.drawImage(bild, Math.round(x - bild.width / 2), unten - bild.height);
      ctx.restore();
    }

    // Eigenes Auto mit weichem Schatten nach links unten (wie der Beschlag der Werkstatt)
    // Die Straße unter dem Auto liegt immer auf derselben Zeile: Maßstab dort 1 / KAMERA_HOEHE
    function eigenesAuto(ansicht) {
      const autoY = HORIZONT + H / 2 - AUTO_H + 2;
      const ruettel = ansicht.untergrund === "randstein" && Math.floor(ansicht.z / (L * 2)) % 2 ? 1 : 0;
      const ax = Math.round(B / 2 - AUTO_B / 2), ay = autoY - ruettel;
      bodenSchatten(ax + AUTO_B / 2 - 3, ay + AUTO_H - 1, AUTO_B + 16, 13);
      const bildNr = ansicht.lenk < -0.3 ? 0 : ansicht.lenk > 0.3 ? 2 : 1;
      const rahmen = (sprites[bildNr].width - AUTO_B) / 2; // Kontur im Hohen Kontrast
      ctx.drawImage(sprites[bildNr], ax - rahmen, ay - rahmen);
    }

    return { bild, zeichne, get sprites() { return sprites; }, gegnerBild, artBild, setzeModus, get modus() { return modus; } };
  }

  return { B, H, HORIZONT, KAMERA_HOEHE, TIEFE, ABSTAND, SICHT, CVD_FARBEN, erzeuge, autoZeichnen, teamFarben, AUTO_B, AUTO_H, rgb, mische };
});
