/*
 * Streckenblitz: Streckenkarte
 *
 * Die Karte ist die Draufsicht aus strecke.js (Entscheidung #10): je Segment ein Punkt und eine Richtung,
 * 0 ist die Richtung der Zielgeraden, im Uhrzeigersinn wachsend. x zeigt nach Osten, y nach Norden.
 *
 * Zwei Ansichten:
 *  - Die Minikarte im Rennen dreht sich mit: Dein Wagen steht fest etwas unter der Mitte der Platte und zeigt
 *    immer nach oben, die Strecke dreht sich um ihn. Die Richtung kommt aus der Sehne der Strecke von 1200
 *    Einheiten hinter bis 1200 Einheiten vor dem Wagen. Das glättet Ein- und Auslauf der Kurven ohne Verzug,
 *    hängt nur von der Stelle ab (kein Zittern, wenn der Wagen quer versetzt) und kennt keinen Sprung an der
 *    Ziellinie, weil der Winkel nie aufaddiert wird.
 *  - Die Übersicht in der Streckenwahl steht still, Norden oben, mit Start und Ziel und einem Pfeil in
 *    Fahrtrichtung.
 * Gezeichnet wird scharf in Gerätepixeln, nicht im kleinen Spielbild.
 *
 * Rechnen läuft auch unter Node (tests/strecke.mjs), Zeichnen braucht nur einen 2D-Kontext.
 * Fenstername window.Karte.
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik();
  else wurzel.Karte = fabrik();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KONST = Object.freeze({
    SEHNE: 1200,      // halbe Länge der Sehne für die Richtung der Minikarte, in Welteinheiten
    MITTE_Y: 0.6,     // dein Wagen steht bei 60 % der Höhe (etwas unter der Mitte, mehr Sicht nach vorn)
    SICHT: 1.5,       // die Minikarte zeigt das 1,5-Fache der größten Ausdehnung der Strecke über ihre Breite (der Großteil der Runde, voraus mehr)
    PUNKTE_JE: 2,     // jedes zweite Segment ein Punkt der Linie (0,4 Pixel auseinander, bleibt rund)
    RAND: 0.12,       // so viel der Breite blendet am Rand der Minikarte weich aus
  });

  // Daten einer Strecke für die Karte: Punkte der Linie, Ausdehnung, Lage von Start und Ziel
  function erzeuge(strecke) {
    const L = strecke.laenge / strecke.anzahl;
    const k = strecke.karte;
    // Der Bau schließt die Runde auf ganze Segmente genau, es bleiben unter 100 Einheiten Rest (unter 0,1 Pixel).
    // Er wird gleichmäßig über die Runde verteilt, damit die Linie an der Ziellinie ohne Sprung zusammenläuft.
    const rest = { x: k.ende.x - k.punkte[0].x, y: k.ende.y - k.punkte[0].y };
    function punkt(z, quer) {
      const zz = ((z % strecke.laenge) + strecke.laenge) % strecke.laenge;
      const n = Math.min(strecke.anzahl - 1, Math.floor(zz / L));
      const t = zz / L - n;
      const p = k.punkte[n], kurve = strecke.segmente[n].kurve * k.proKurve;
      const mitte = p.richtung + kurve * t / 2;
      const anteil = zz / strecke.laenge;
      let x = p.x + L * t * Math.sin(mitte) - rest.x * anteil;
      let y = p.y + L * t * Math.cos(mitte) - rest.y * anteil;
      if (quer) {
        // quer in halben Fahrbahnbreiten, rechts positiv: rechts der Fahrtrichtung (sin r, cos r) liegt (cos r, -sin r)
        const r = p.richtung + kurve * t, b = quer * strecke.breite;
        x += b * Math.cos(r);
        y -= b * Math.sin(r);
      }
      return { x, y };
    }
    const linie = [];
    for (let n = 0; n < strecke.anzahl; n += KONST.PUNKTE_JE) linie.push(punkt(n * L));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of linie) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    return {
      strecke, linie, punkt,
      kasten: { x0, x1, y0, y1 },
      spanne: Math.max(x1 - x0, y1 - y0),
      uhrzeiger: k.ende.richtung > 0,
    };
  }

  // Richtung der Strecke an der Stelle z (Bogenmaß, 0 Norden, im Uhrzeigersinn), aus der Sehne um z
  function winkelBei(karte, z) {
    const a = karte.punkt(z - KONST.SEHNE), b = karte.punkt(z + KONST.SEHNE);
    return Math.atan2(b.x - a.x, b.y - a.y);
  }

  // Kleinster Unterschied zweier Winkel, immer zwischen -π und π
  function winkelAbstand(a, b) {
    const d = (b - a) % (2 * Math.PI);
    return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d;
  }

  /*
   * Abbildung der Minikarte: Weltpunkt nach Bildpunkt. Die Stelle mitte landet auf (cx, cy), die Richtung
   * winkel zeigt nach oben. Bildpunkte wachsen nach rechts und nach unten.
   */
  function abbildung(mitte, winkel, massstab, cx, cy) {
    const c = Math.cos(winkel), s = Math.sin(winkel);
    return function (p) {
      const dx = p.x - mitte.x, dy = p.y - mitte.y;
      return [cx + massstab * (dx * c - dy * s), cy - massstab * (dx * s + dy * c)];
    };
  }

  // Maßstab der Minikarte für eine Platte dieser Breite (Bildpunkte je Welteinheit)
  const massstabMini = (karte, breite) => breite / (karte.spanne * KONST.SICHT);

  // --- Zeichnen -------------------------------------------------------------------------------------

  function pfad(ctx, punkte, bild) {
    ctx.beginPath();
    for (let i = 0; i < punkte.length; i++) {
      const [x, y] = bild(punkte[i]);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  // Strecke als Linie: breiter dunkler Saum, darauf die Linie
  function streckeZeichnen(ctx, karte, bild, f, d) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    pfad(ctx, karte.linie, bild);
    if (f.saum) {
      ctx.strokeStyle = f.saum;
      ctx.lineWidth = f.saumBreite * d;
      ctx.stroke();
    }
    ctx.strokeStyle = f.linie;
    ctx.lineWidth = f.linieBreite * d;
    ctx.stroke();
  }

  // Start und Ziel: ein Strich quer über die Strecke, mit dunklem Saum
  function zielZeichnen(ctx, karte, bild, f, d, laenge) {
    const a = bild(karte.punkt(0, -1)), b = bild(karte.punkt(0, 1));
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    let ux = b[0] - a[0], uy = b[1] - a[1];
    const l = Math.hypot(ux, uy) || 1;
    ux /= l; uy /= l;
    const h = laenge * d / 2;
    ctx.lineCap = "butt";
    ctx.beginPath();
    ctx.moveTo(mx - ux * h, my - uy * h);
    ctx.lineTo(mx + ux * h, my + uy * h);
    if (f.saum) {
      ctx.strokeStyle = f.saum;
      ctx.lineWidth = (f.zielBreite + 2) * d;
      ctx.stroke();
    }
    ctx.strokeStyle = f.ziel;
    ctx.lineWidth = f.zielBreite * d;
    ctx.stroke();
  }

  // Pfeil in Fahrtrichtung kurz nach der Linie (nur in der Übersicht)
  function pfeilZeichnen(ctx, karte, bild, f, d, groesse) {
    // so weit nach der Linie, dass der Pfeil den Zielstrich nicht berührt, auch auf einer kleinen Karte
    const s = bild(karte.punkt(0));
    let z = 400;
    while (z < karte.strecke.laenge * 0.2) {
      const p = bild(karte.punkt(z));
      if (Math.hypot(p[0] - s[0], p[1] - s[1]) >= groesse * 1.6 * d) break;
      z += 400;
    }
    const a = bild(karte.punkt(z - 400)), b = bild(karte.punkt(z + 400)), m = bild(karte.punkt(z));
    let ux = b[0] - a[0], uy = b[1] - a[1];
    const l = Math.hypot(ux, uy) || 1;
    ux /= l; uy /= l;
    const g = groesse * d;
    ctx.save();
    ctx.translate(m[0], m[1]);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.beginPath();
    ctx.moveTo(g * 0.7, 0);
    ctx.lineTo(-g * 0.5, -g * 0.62);
    ctx.lineTo(-g * 0.22, 0);
    ctx.lineTo(-g * 0.5, g * 0.62);
    ctx.closePath();
    if (f.saum) {
      ctx.strokeStyle = f.saum;
      ctx.lineWidth = 2.4 * d;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.fillStyle = f.pfeil;
    ctx.fill();
    ctx.restore();
  }

  /*
   * Minikarte. ansicht:
   *   breite, hoehe   Größe in Gerätepixeln, d Gerätepixel je CSS-Pixel
   *   z, x            Stelle und Querlage deines Wagens
   *   gegner          [{ z, x, farbe, nummer }]
   *   farben          siehe index.html (kartenFarben)
   *   nummern         Startnummern neben die Punkte schreiben (Farbenblind, Hoher Kontrast)
   * Liefert den Winkel und die Stelle deines Wagens im Bild (für Prüfungen).
   */
  function zeichneMini(ctx, karte, ansicht) {
    const { breite: B, hoehe: H, d, farben: f } = ansicht;
    const winkel = winkelBei(karte, ansicht.z);
    const ich = karte.punkt(ansicht.z, ansicht.x);
    const cx = B / 2, cy = H * KONST.MITTE_Y;
    const bild = abbildung(ich, winkel, massstabMini(karte, B), cx, cy);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, B, H);
    streckeZeichnen(ctx, karte, bild, f, d);
    zielZeichnen(ctx, karte, bild, f, d, 9);

    // Gegner als Punkte mit dunklem Ring, auf Wunsch mit Startnummer
    const r = 2.9 * d;
    const punkte = [];
    for (const g of ansicht.gegner) {
      const [x, y] = bild(karte.punkt(g.z, g.x));
      if (x < -10 * d || y < -10 * d || x > B + 10 * d || y > H + 10 * d) continue;
      punkte.push({ x, y, g });
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = g.farbe;
      ctx.fill();
      ctx.lineWidth = 1.1 * d;
      ctx.strokeStyle = f.ring;
      ctx.stroke();
    }
    // Startnummern: die nächsten zuerst; eine Nummer, die eine schon geschriebene oder deinen Pfeil überdecken würde,
    // bleibt weg (im Pulk am Start stünden sie sonst übereinander). Damit nichts blinkt, wechselt eine Nummer zwischen
    // sichtbar und weg höchstens alle 0,5 s (ansicht.stand merkt sich das je Startnummer, ansicht.zeit in Sekunden).
    if (ansicht.nummern) {
      ctx.font = "600 " + (8.5 * d).toFixed(1) + "px " + f.schrift;
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      const belegt = [[cx - 7 * d, cy - 7.5 * d, cx + 7 * d, cy + 6 * d]];
      const stand = ansicht.stand || {}, jetzt = ansicht.zeit || 0;
      punkte.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
      for (const { x, y, g } of punkte) {
        if (g.nummer == null) continue;
        const text = String(g.nummer), tx = x + r + 1.6 * d, ty = y - r;
        const kasten = [tx - d, ty - 5 * d, tx + ctx.measureText(text).width + d, ty + 5 * d];
        const frei = !belegt.some((k) => kasten[0] < k[2] && kasten[2] > k[0] && kasten[1] < k[3] && kasten[3] > k[1]);
        const s = stand[g.nummer] || (stand[g.nummer] = { an: frei, seit: jetzt });
        if (s.an !== frei && jetzt - s.seit >= 0.5) { s.an = frei; s.seit = jetzt; }
        if (!s.an) continue;
        belegt.push(kasten);
        ctx.lineWidth = 2.6 * d;
        ctx.strokeStyle = f.hof;
        ctx.strokeText(text, tx, ty);
        ctx.fillStyle = f.nummer;
        ctx.fillText(text, tx, ty);
      }
    }

    // Weich ausblenden zum Rand der Platte (oben, unten, links, rechts)
    ctx.globalCompositeOperation = "destination-in";
    for (const [x1, y1] of [[B, 0], [0, H]]) {
      const v = ctx.createLinearGradient(0, 0, x1, y1);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(KONST.RAND, "#000");
      v.addColorStop(1 - KONST.RAND, "#000");
      v.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, B, H);
    }
    ctx.globalCompositeOperation = "source-over";

    // Du: ein Pfeil nach oben, größer als die Punkte, mit hellem Rand (Form statt nur Farbe)
    const g = 6.2 * d;
    ctx.beginPath();
    ctx.moveTo(cx, cy - g);
    ctx.lineTo(cx + g * 0.72, cy + g * 0.72);
    ctx.lineTo(cx, cy + g * 0.32);
    ctx.lineTo(cx - g * 0.72, cy + g * 0.72);
    ctx.closePath();
    ctx.lineJoin = "round";
    if (f.saum) {
      ctx.lineWidth = 3.6 * d;
      ctx.strokeStyle = f.saum;
      ctx.stroke();
    }
    ctx.fillStyle = f.du;
    ctx.fill();
    ctx.lineWidth = 1.3 * d;
    ctx.strokeStyle = f.duRand;
    ctx.stroke();
    return { winkel, cx, cy };
  }

  // Übersicht für die Streckenwahl: still, Norden oben, Start und Ziel, Pfeil in Fahrtrichtung
  function zeichneUebersicht(ctx, karte, ansicht) {
    const { breite: B, hoehe: H, d, farben: f } = ansicht;
    const rand = 9 * d;
    const k = karte.kasten;
    const m = Math.min((B - 2 * rand) / (k.x1 - k.x0), (H - 2 * rand) / (k.y1 - k.y0));
    const mitte = { x: (k.x0 + k.x1) / 2, y: (k.y0 + k.y1) / 2 };
    const bild = abbildung(mitte, 0, m, B / 2, H / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, B, H);
    if (f.grund) {
      ctx.fillStyle = f.grund;
      ctx.fillRect(0, 0, B, H);
    }
    streckeZeichnen(ctx, karte, bild, f, d);
    zielZeichnen(ctx, karte, bild, f, d, 11);
    pfeilZeichnen(ctx, karte, bild, f, d, 8);
    return { massstab: m };
  }

  return { KONST, erzeuge, winkelBei, winkelAbstand, abbildung, massstabMini, zeichneMini, zeichneUebersicht };
});
