/*
 * Streckenblitz: Deko als Pixelbilder aus Code
 *
 * Jedes Bild wird einmal je Strecke in eine Leinwand gemalt, mit den Farben der Strecke
 * (farben.deko): Palmen, Felsen, Kakteen, Tannen, Laternen, Pfeiltafeln, Tribünen, die
 * Start-Ziel-Brücke, ein Leuchtturm und Hütten. Ein Bildpixel entspricht KUNST Welteinheiten.
 * Gemalt wird nur mit ganzen Rechtecken (fillRect), also ohne Kantenglättung: scharfe Pixel.
 * Licht fällt warm von links (Restlicht am Himmel), rechts liegt Schatten.
 *
 * malen(art, variante, farben, neueLeinwand) liefert { bild, fussX, lichter }:
 *   fussX    Spalte, die auf dem Boden an der Stelle der Deko steht (Mast, Stamm, Mitte)
 *   lichter  Lampen für den weichen Lichtschein: { x, y } im Bild, r in Welteinheiten, staerke 0..1,
 *            boden: true heißt, die Lampe wirft auch einen Lichtfleck auf die Straße
 *
 * Läuft nur im Browser (braucht Canvas), Fenstername window.Deko.
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik();
  else wurzel.Deko = fabrik();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KUNST = 16; // Welteinheiten je Bildpixel

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hex(c) {
    const k = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return "#" + ((1 << 24) | (k(c[0]) << 16) | (k(c[1]) << 8) | k(c[2])).toString(16).slice(1);
  }
  // Mischfarbe zweier Hex-Farben (t = 0: a, t = 1: b)
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
  }
  function zufallAus(samen) {
    let s = samen >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // Malwerkzeug auf einem Canvas-Kontext: nur ganze Pixel
  function maler(ctx) {
    const r = (x, y, b, h, f) => {
      const x0 = Math.round(x), y0 = Math.round(y), x1 = Math.round(x + b), y1 = Math.round(y + h);
      if (x1 > x0 && y1 > y0) { ctx.fillStyle = f; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    };
    const p = (x, y, f) => r(x, y, 1, 1, f);
    const zeile = (y, x0, x1, f) => r(x0, y, x1 - x0, 1, f);
    function ellipse(cx, cy, rx, ry, f) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        const t = (y + 0.5 - cy) / ry;
        if (Math.abs(t) > 1) continue;
        const h = rx * Math.sqrt(1 - t * t);
        zeile(y, Math.round(cx - h), Math.round(cx + h), f);
      }
    }
    // Vieleck mit Zeilenfüllung (gerade-ungerade)
    function poly(pkte, f) {
      const ys = pkte.map((q) => q[1]);
      for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
        const yc = y + 0.5, xs = [];
        for (let i = 0; i < pkte.length; i++) {
          const [ax, ay] = pkte[i], [bx, by] = pkte[(i + 1) % pkte.length];
          if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
        }
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2) zeile(y, Math.round(xs[i]), Math.round(xs[i + 1]), f);
      }
    }
    function linie(x0, y0, x1, y1, d, f) {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
        r(Math.round(x - d / 2), Math.round(y - d / 2), d, d, f);
      }
    }
    return { r, p, zeile, ellipse, poly, linie, ctx };
  }

  // --- Die Bilder ----------------------------------------------------------------

  // Palme: gebogener, geringelter Stamm, volle Krone aus hängenden, gefiederten Wedeln
  function palme(m, F, z, v) {
    const B = 120, H = 196;
    const neigung = [-12, 8, 15][v % 3];
    const fuss = 60 - Math.round(neigung * 0.4);
    const kroneY = 58 + (v % 3) * 8;
    const mitte = (y) => fuss + neigung * Math.pow((H - y) / (H - kroneY), 1.6);
    for (let y = kroneY; y < H; y++) {
      const t = (H - y) / (H - kroneY);
      const halb = 3.8 - 1.5 * t;
      const cx = mitte(y), x0 = Math.round(cx - halb), x1 = Math.round(cx + halb);
      const ring = (y - kroneY) % 5 === 0;
      m.zeile(y, x0, x1, ring ? mix(F.stamm[1], F.stamm[0], 0.6) : F.stamm[1]);
      m.zeile(y, x1 - 2, x1, F.stamm[0]);
      m.p(x0, y, ring ? F.stamm[2] : mix(F.stamm[2], F.kante, 0.35));
    }
    m.zeile(H - 1, fuss - 7, fuss + 7, F.stamm[0]);
    const kx = mitte(kroneY), ky = kroneY;
    // Wedel: [Winkel in Grad (0 rechts, 90 oben), Länge, vorn]; hinten dunkler, vorn mit Lichtkante
    const wedel = [[160, 40, 0], [20, 40, 0], [95, 26, 0], [200, 34, 0], [-20, 34, 0],
      [178, 46, 1], [140, 36, 1], [110, 28, 1], [70, 28, 1], [40, 38, 1], [2, 46, 1], [215, 30, 1], [-35, 30, 1]];
    for (const [winkel, laenge, vorn] of wedel) {
      const a = ((winkel + (z() - 0.5) * 12) * Math.PI) / 180;
      const L = laenge * (0.9 + z() * 0.2), haengen = L * (0.75 + z() * 0.25);
      const dx = Math.cos(a), dy = -Math.sin(a);
      const rippe = vorn ? F.laub[1] : F.laub[0];
      const fieder = vorn ? mix(F.laub[1], F.laub[0], 0.45) : mix(F.laub[0], "#000000", 0.2);
      const punkt = (t) => [kx + dx * L * t, ky + dy * L * t * 0.7 + haengen * t * t];
      let [vx, vy] = punkt(0);
      for (let i = 1; i <= 30; i++) {
        const t = i / 30;
        const [x, y] = punkt(t);
        // Fiedern beidseits, hängend; in der Mitte des Wedels am längsten
        const lang = 1.5 + 7 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.8);
        if (t > 0.08) {
          m.linie(x, y, x - dy * lang * 0.35 + dx * 1.2, y + lang * 0.85, 1, fieder);
          m.linie(x, y, x + dy * lang * 0.35 + dx * 1.2, y + lang * 0.7, 1, fieder);
        }
        m.linie(vx, vy, x, y, t < 0.4 ? 2 : 1, rippe);
        if (vorn && t < 0.85) m.p(Math.round(x), Math.round(y) - 1, i % 4 ? F.laub[2] : mix(F.laub[2], F.kante, 0.5));
        vx = x; vy = y;
      }
    }
    m.ellipse(kx, ky + 1, 4, 3, F.laub[0]);
    for (const [ex, ey] of [[-3, 3], [1, 4], [3, 2]]) m.r(kx + ex - 1, ky + ey, 2, 2, F.stamm[0]);
    return { b: B, h: H, fussX: fuss };
  }

  // Felsen: unregelmäßiger Block mit Lichtkante oben links, Schatten rechts unten, Rissen
  function fels(m, F, z, v) {
    const masse = [[54, 32], [42, 25], [66, 40]][v % 3];
    const [B, H] = masse;
    const n = 11, pkte = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI; // obere Hälfte, von links nach rechts
      const rr = 0.78 + z() * 0.22;
      pkte.push([B / 2 + Math.cos(a) * (B / 2 - 1) * rr, H - 1 + Math.sin(a) * (H - 2) * rr * (i === 0 || i === n - 1 ? 0.25 : 1)]);
    }
    pkte.push([B - 1, H], [1, H]);
    m.poly(pkte, F.stein[1]);
    // Schatten: rechte untere Hälfte, gegen die Mitte versetzt
    const schatten = pkte.map(([x, y]) => [x + (B - x) * 0.0 + 4, y + 5]).filter(([x]) => x > B * 0.45);
    if (schatten.length > 2) m.poly([[B * 0.5, H], ...schatten.map(([x, y]) => [Math.min(B - 1, x), Math.min(H, y)]), [B - 1, H]], F.stein[0]);
    // Lichtkante: obere linke Umrisslinie
    for (let i = 1; i < n / 2; i++) {
      const [x0, y0] = pkte[i - 1], [x1, y1] = pkte[i];
      m.linie(x0 + 1, y0 + 1, x1 + 1, y1 + 1, 1, i < 3 ? mix(F.stein[2], F.kante, 0.5) : F.stein[2]);
    }
    // Facetten und Risse
    for (let k = 0; k < 3; k++) {
      const x = B * (0.25 + z() * 0.5), y = H * (0.3 + z() * 0.3);
      m.linie(x, y, x + (z() - 0.5) * 8, y + 4 + z() * 6, 1, F.stein[0]);
    }
    m.zeile(H - 1, 0, B, mix(F.stein[0], "#000000", 0.4));
    return { b: B, h: H, fussX: Math.round(B / 2) };
  }

  // Kaktus (Säulenkaktus): Stamm und Arme mit Rippen, Mondlicht links, runde Kuppen
  function kaktus(m, F, z, v) {
    const B = 64, H = 118, fuss = 32;
    const saeule = (x0, y0, y1, breit) => {
      const r = breit / 2;
      m.ellipse(x0 + r, y0 + r, r, r, F.laub[1]);
      m.r(x0, y0 + r, breit, y1 - y0 - r, F.laub[1]);
      // Rippen: abwechselnd Rille und heller Grat
      for (let x = x0 + 2; x < x0 + breit - 2; x += 3) {
        m.r(x, y0 + r, 1, y1 - y0 - r, F.laub[0]);
        m.r(x + 1, y0 + r + 1, 1, y1 - y0 - r - 1, mix(F.laub[1], F.laub[2], 0.5));
      }
      m.r(x0, y0 + r, 1, y1 - y0 - r, F.kante);
      m.r(x0 + 1, y0 + r, 1, y1 - y0 - r, F.laub[2]);
      m.r(x0 + breit - 2, y0 + r, 2, y1 - y0 - r, F.laub[0]);
      m.p(x0 + 2, y0 + 1, F.laub[2]);
      m.p(x0 + 1, y0 + 2, F.kante);
    };
    // Arme: [Höhe des Ansatzes, links (-1) oder rechts (1), Oberkante]
    const arme = [[[60, -1, 26], [72, 1, 38]], [[54, 1, 24], [84, -1, 58]], [[66, -1, 40]]][v % 3];
    for (const [hoehe, seite, oben] of arme) {
      const ax = seite < 0 ? 6 : 46;
      saeule(ax, oben, hoehe + 9, 11);
      const x0 = seite < 0 ? ax + 5 : 37, x1 = seite < 0 ? 27 : ax + 6;
      m.r(x0, hoehe, x1 - x0, 9, F.laub[1]);
      m.r(x0, hoehe + 7, x1 - x0, 2, F.laub[0]);
      m.r(x0, hoehe, x1 - x0, 1, F.laub[2]);
    }
    saeule(25, 4 + (v % 3) * 5, H, 14);
    m.zeile(H - 1, fuss - 9, fuss + 9, mix(F.stein[0], "#000000", 0.3));
    return { b: B, h: H, fussX: fuss };
  }

  // Tanne: gestufte Äste mit zackiger Unterkante, ungleich, letztes Licht links
  function tanne(m, F, z, v) {
    const B = 76, H = 224, fuss = 38;
    const spitze = 6 + (v % 3) * 12;
    m.r(fuss - 3, H - 30, 6, 30, F.stamm[1]);
    m.r(fuss + 1, H - 30, 2, 30, F.stamm[0]);
    m.r(fuss - 3, H - 30, 1, 30, F.stamm[2]);
    const stufen = 7 + (v % 2);
    for (let i = 0; i < stufen; i++) {
      const t = i / (stufen - 1);                 // 0 unten, 1 oben
      const unten = H - 26 - t * (H - 26 - spitze - 22) + (z() - 0.5) * 4;
      const hoehe = 36 - t * 14;
      const breit = (34 * Math.pow(1 - t * 0.86, 0.95) + 3) * (0.88 + z() * 0.24);
      const versatz = (z() - 0.5) * 3;
      const mx = fuss + versatz;
      const oben = unten - hoehe;
      // Stufe als Dreieck, Unterkante mit ungleich hängenden Zweigspitzen
      const pk = [[mx, oben]];
      const zacken = Math.max(3, Math.round(breit / 3.5));
      for (let k = 0; k <= zacken; k++) {
        const x = mx + breit - (2 * breit * k) / zacken;
        pk.push([x, unten + (k % 2 ? -1 : 2 + z() * 4)]);
      }
      m.poly(pk, F.laub[1]);
      // Schatten rechts und unter der Stufe
      m.poly([[mx + 1, oben + 5], [mx + breit - 1, unten + 1], [mx + 1, unten + 1]], F.laub[0]);
      m.poly([[mx - breit + 4, unten - 3], [mx + breit - 4, unten - 3], [mx + breit, unten + 1], [mx - breit, unten + 1]], mix(F.laub[0], "#000000", 0.25));
      // Nadelbüschel: ein paar hellere Tupfen auf der Lichtseite
      for (let k = 0; k < 5; k++) {
        const yy = oben + 6 + z() * (hoehe - 10), xx = mx - z() * breit * ((yy - oben) / hoehe) * 0.8;
        m.r(xx, yy, 2, 1, F.laub[2]);
      }
      // Licht: linke obere Kante
      for (let y = oben + 1; y < unten - 2; y++) {
        const x = mx - ((y - oben) / hoehe) * breit;
        if (z() < 0.8) m.p(Math.round(x) + 1, y, (y % 4) ? F.laub[2] : mix(F.laub[2], F.kante, 0.6));
      }
    }
    m.r(fuss - 1, spitze - 4, 2, 8, F.laub[1]);
    m.p(fuss - 1, spitze - 3, F.laub[2]);
    return { b: B, h: H, fussX: fuss };
  }

  // Laterne: dünner Mast, Arm zur Straße (nach rechts), warmes Glas
  function laterne(m, F) {
    const B = 30, H = 112, fuss = 5;
    m.r(2, H - 6, 7, 6, F.metall[0]);
    m.r(2, H - 6, 7, 1, F.metall[1]);
    m.r(4, 14, 3, H - 18, F.metall[0]);
    m.r(4, 14, 1, H - 18, F.metall[1]);
    // Arm mit leichtem Bogen
    for (let x = 5; x <= 24; x++) {
      const y = 13 - Math.round(Math.sin(((x - 5) / 19) * Math.PI) * 3);
      m.r(x, y, 1, 2, F.metall[0]);
      m.p(x, y, F.metall[1]);
    }
    m.r(20, 12, 9, 3, F.metall[0]);
    m.r(20, 12, 9, 1, F.metall[1]);
    m.r(21, 15, 7, 2, F.lampe);
    m.r(22, 15, 5, 1, mix(F.lampe, "#ffffff", 0.12));
    return { b: B, h: H, fussX: fuss, lichter: [{ x: 24.5, y: 16, r: 520, staerke: 0.55, boden: true }] };
  }

  // Pfeiltafel vor Kurven: dunkle Tafel, drei gedämpfte Winkel nach rechts
  function schild(m, F) {
    const B = 54, H = 46;
    m.r(12, 26, 3, 20, F.metall[0]);
    m.r(39, 26, 3, 20, F.metall[0]);
    m.r(12, 26, 1, 20, F.metall[1]);
    m.r(39, 26, 1, 20, F.metall[1]);
    m.r(0, 0, B, 27, F.metall[1]);
    m.r(1, 1, B - 2, 25, F.tafel);
    m.r(1, 1, B - 2, 1, mix(F.metall[1], F.kante, 0.4));
    for (let k = 0; k < 3; k++) {
      const x0 = 9 + k * 13;
      for (let i = 0; i < 8; i++) {
        m.r(x0 + i, 5 + i, 4, 1, F.pfeil);
        m.r(x0 + i, 20 - i, 4, 1, F.pfeil);
      }
      m.r(x0 + 8, 12, 4, 2, F.pfeil);
    }
    return { b: B, h: H, fussX: 27 };
  }

  // Tribüne: Dach auf Stützen, sechs Sitzreihen mit Zuschauern in Lebensgröße (Kopf und Schultern), Mauer vorn
  function tribuene(m, F, z) {
    const B = 156, H = 112;
    m.r(0, 18, B, 94, F.wand[0]);
    for (let reihe = 5; reihe >= 0; reihe--) {
      const y = 79 - reihe * 12;               // Oberkante der Reihe
      const dunkel = reihe / 9;
      // Stufe mit Sitzlehnen
      m.r(2, y + 7, B - 4, 5, mix(F.wand[1], F.wand[0], dunkel));
      m.r(2, y + 7, B - 4, 1, mix(F.wand[2], F.wand[0], dunkel));
      for (let x = 3 + (reihe % 2) * 3; x < B - 8; x += 6 + Math.floor(z() * 3)) {
        if (z() < 0.25) continue;
        const farbe = mix(F.menge[Math.floor(z() * F.menge.length)], F.wand[0], dunkel + z() * 0.15);
        const haut = mix(mix(F.menge[0], F.kante, 0.45), F.wand[0], dunkel + 0.1);
        const steht = z() < 0.12 ? 2 : 0;
        m.r(x, y + 5 - steht, 5, 6 + steht, farbe);          // Schultern und Oberkörper
        m.r(x, y + 10, 5, 1, mix(farbe, "#000000", 0.35));
        m.r(x + 1, y + 1 - steht, 3, 4, haut);                // Kopf
        m.r(x + 1, y + 1 - steht, 3, 1, mix(haut, F.menge[Math.floor(z() * F.menge.length)], 0.5)); // Haar oder Mütze
        m.p(x, y + 5 - steht, mix(farbe, F.kante, 0.3));      // Licht auf der linken Schulter
      }
    }
    // Dach und Stützen
    for (const x of [4, 52, 100, 148]) m.r(x, 18, 3, 72, F.dach);
    m.r(0, 10, B, 9, F.dach);
    m.r(0, 10, B, 1, mix(F.dach, F.kante, 0.55));
    m.r(0, 18, B, 2, mix(F.dach, "#000000", 0.3));
    // Mauer vorn mit gedämpftem Streifen
    m.r(0, 91, B, 21, F.wand[2]);
    m.r(0, 97, B, 3, mix(F.wand[2], F.turm[1], 0.45));
    m.r(0, 91, B, 1, mix(F.wand[2], F.kante, 0.35));
    m.r(0, 110, B, 2, F.wand[0]);
    return { b: B, h: H, fussX: B / 2 };
  }

  // Start-Ziel-Brücke: zwei Pfeiler, Träger mit gedämpftem Schachbrett, kleine Lampen darunter
  function bruecke(m, F) {
    const B = 224, H = 176, mitte = 112;
    const pfeiler = [mitte - 101, mitte + 101];
    for (const px of pfeiler) {
      m.r(px - 8, 40, 16, H - 40, F.wand[1]);
      m.r(px - 8, 40, 2, H - 40, mix(F.wand[2], F.kante, 0.35));
      m.r(px + 4, 40, 4, H - 40, F.wand[0]);
      m.r(px - 10, H - 8, 20, 8, F.wand[0]);
      for (let y = 70; y < H - 8; y += 22) m.r(px - 8, y, 16, 1, F.wand[0]);
    }
    m.r(0, 40, B, 26, F.wand[1]);
    m.r(0, 40, B, 2, mix(F.wand[2], F.kante, 0.45));
    m.r(0, 63, B, 3, F.wand[0]);
    // Schachbrett, kaum Helligkeitsunterschied
    for (let x = 6; x < B - 6; x += 8) {
      for (let r = 0; r < 2; r++) m.r(x, 46 + r * 6, 8, 6, ((x / 8 + r) & 1) ? F.wand[2] : F.wand[0]);
    }
    m.r(6, 58, B - 12, 1, F.wand[0]);
    const lichter = [];
    for (let k = 0; k < 7; k++) {
      const x = 34 + k * 26;
      m.r(x - 2, 66, 4, 2, F.metall[0]);
      m.r(x - 1, 68, 2, 1, F.lampe);
      lichter.push({ x, y: 68.5, r: 200, staerke: 0.35 });
    }
    return { b: B, h: H, fussX: mitte, lichter };
  }

  // Leuchtturm: verjüngter Turm mit breiten Bändern, Galerie, ruhig leuchtendes Laternenhaus (dreht sich nicht)
  function leuchtturm(m, F) {
    const B = 60, H = 390, fuss = 30;
    for (let y = 70; y < H; y++) {
      const t = (H - y) / (H - 70);
      const halb = 13 - t * 5;
      const band = Math.floor((y - 70) / 44) % 2;
      const x0 = Math.round(fuss - halb), x1 = Math.round(fuss + halb);
      m.zeile(y, x0, x1, band ? F.turm[1] : F.turm[0]);
      m.zeile(y, x1 - 3, x1, mix(band ? F.turm[1] : F.turm[0], "#000000", 0.35));
      m.p(x0, y, mix(band ? F.turm[1] : F.turm[0], F.kante, 0.5));
    }
    m.r(fuss - 14, H - 6, 28, 6, F.stein[1]);
    m.r(fuss - 12, 64, 24, 6, F.metall[0]);
    m.r(fuss - 12, 64, 24, 1, mix(F.metall[1], F.kante, 0.4));
    m.r(fuss - 12, 60, 1, 4, F.metall[1]);
    m.r(fuss + 11, 60, 1, 4, F.metall[1]);
    m.r(fuss - 12, 60, 24, 1, F.metall[1]);
    m.r(fuss - 6, 44, 12, 20, F.metall[0]);
    m.r(fuss - 5, 46, 10, 16, mix(F.lampe, F.metall[0], 0.25));
    m.r(fuss - 1, 46, 2, 16, F.metall[0]);
    m.poly([[fuss - 8, 45], [fuss, 32], [fuss + 8, 45]], F.dach);
    m.r(fuss - 1, 28, 2, 5, F.metall[1]);
    return { b: B, h: H, fussX: fuss, lichter: [{ x: fuss, y: 54, r: 1500, staerke: 0.5 }] };
  }

  // Hütte: Holzwand, Dach mit Lichtkante, Kamin, zwei warme Fenster
  function huette(m, F, z, v) {
    const B = 112, H = 84;
    m.r(8, 40, 96, 44, F.wand[1]);
    for (let y = 43; y < H; y += 4) m.r(8, y, 96, 1, F.wand[0]);
    m.r(8, 40, 2, 44, F.wand[2]);
    m.r(98, 40, 6, 44, F.wand[0]);
    m.poly([[0, 44], [56, 8], [112, 44]], F.dach);
    m.linie(1, 43, 55, 9, 1, mix(F.dach, F.kante, 0.6));
    m.r(0, 43, 112, 2, mix(F.dach, "#000000", 0.35));
    m.r(80, 14, 8, 16, F.stein[1]);
    m.r(80, 14, 1, 16, F.stein[2]);
    const lichter = [];
    const fenster = v % 2 ? [[22, 54], [74, 54]] : [[28, 54]];
    for (const [x, y] of fenster) {
      m.r(x - 1, y - 1, 14, 12, F.wand[0]);
      m.r(x, y, 12, 10, F.lampe);
      m.r(x, y + 6, 12, 4, mix(F.lampe, F.wand[0], 0.25));
      m.r(x + 5, y, 2, 10, F.wand[0]);
      m.r(x, y + 4, 12, 1, F.wand[0]);
      lichter.push({ x: x + 6, y: y + 5, r: 380, staerke: 0.3 });
    }
    m.r(52, 58, 12, 26, F.wand[0]);
    m.r(52, 58, 12, 1, mix(F.wand[0], F.kante, 0.3));
    return { b: B, h: H, fussX: B / 2, lichter };
  }

  const MALER = { palme, fels, kaktus, tanne, laterne, schild, tribuene, bruecke, leuchtturm, huette };
  // So viele Spielarten gibt es je Bild (die Grafik wählt nach der Stelle)
  const VARIANTEN = { palme: 3, fels: 3, kaktus: 3, tanne: 3, huette: 2 };

  // Ein Bild malen. Die Leinwand wird nach dem Malen auf die belegte Größe zugeschnitten.
  function malen(art, variante, farben, neueLeinwand) {
    const roh = neueLeinwand(400, 400);
    const ctx = roh.getContext("2d");
    const z = zufallAus(1000 + variante * 7919 + art.length * 31);
    const info = MALER[art](maler(ctx), farben, z, variante);
    const bild = neueLeinwand(info.b, info.h);
    bild.getContext("2d").drawImage(roh, 0, 0);
    return { bild, b: info.b, h: info.h, fussX: info.fussX, lichter: info.lichter || [] };
  }

  return { KUNST, malen, VARIANTEN, ARTEN: Object.keys(MALER), mix };
});
