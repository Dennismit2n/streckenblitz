/*
 * Streckenblitz: Streckendaten und Streckenbau
 *
 * Eine Strecke ist eine geschlossene Folge gleich langer Segmente. Jedes Segment trägt
 *   kurve  wie stark die Straße an dieser Stelle zur Seite biegt (rechts positiv, links negativ),
 *   y1, y2 die Höhe am Anfang und am Ende des Segments (Welteinheiten).
 * Die Pseudo-3D-Ansicht addiert die Kurvenwerte zu einer Querverschiebung auf, die Physik
 * leitet daraus die Fliehkraft ab.
 *
 * Gebaut wird aus einem Bauplan aus Stücken: Geraden und Kurven mit sanftem Ein- und Auslauf,
 * dazu eine Zielhöhe je Stück (weicher Übergang über die ganze Stücklänge).
 * Aus den Kurvenwerten entsteht außerdem eine Draufsicht (karte), die Runde schließt sich dort
 * wirklich: Zwei Geraden des Bauplans sind dehnbar und werden so verlängert, dass Anfang und
 * Ende auf der Karte zusammenfallen.
 *
 * Neben der Straße steht Deko (Palmen, Kakteen, Tannen, Felsen, Laternen, Schilder, Tribünen,
 * die Start-Ziel-Brücke). Sie wird hier aus festen Regeln und einem festen Samen gesetzt, damit
 * Grafik und Physik dieselbe Liste benutzen: Was nah genug an der Fahrbahn steht, ist ein Hindernis.
 *
 * Die Datei läuft im Browser (window.Strecke) und unter Node (require), ohne DOM.
 */
(function (wurzel, fabrik) {
  if (typeof module === "object" && module.exports) module.exports = fabrik();
  else wurzel.Strecke = fabrik();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KONST = Object.freeze({
    SEGMENT_LAENGE: 200,  // Welteinheiten je Segment
    BREITE: 1000,         // halbe Fahrbahnbreite; x = 1 ist der rechte Fahrbahnrand
    RANDSTEIN: 0.14,      // Breite der Randsteine, in halben Fahrbahnbreiten
    STREIFEN: 4,          // so viele Segmente lang ist ein Farbfeld der Randsteine und des Grases
    MIN_GERADE: 20,       // kürzer darf eine dehnbare Gerade beim Schließen nicht werden
    HINDERNIS_BIS: 2.6,   // Deko näher als so viele halbe Fahrbahnbreiten (Außenkante) ist ein Hindernis
    START_FREI: [70, 24], // so viele Segmente vor und nach der Linie keine zufällige Deko nahe der Fahrbahn
  });

  // Breite der Deko für Berührungen, in halben Fahrbahnbreiten (Stamm, Mast oder Stein, nicht die Krone)
  const DEKO_BREITE = Object.freeze({
    palme: 0.12, fels: 0.34, kaktus: 0.18, tanne: 0.26, laterne: 0.07, schild: 0.3,
    pfeiler: 0.24, tribuene: 1.9, leuchtturm: 0.6, huette: 1.2, bruecke: 0,
  });

  // Weicher Übergang 0 bis 1 (ohne Knick am Anfang und am Ende)
  function sanft(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }

  // Bausteine des Bauplans. auf: Zielhöhe am Stückende (fehlt sie, bleibt die Höhe).
  function gerade(laenge, auf, name, dehnbar) {
    return { name: name || "Gerade", ein: 0, halte: laenge, aus: 0, kurve: 0, auf, dehnbar: !!dehnbar };
  }
  function kurve(ein, halte, aus, staerke, auf, name) {
    return { name: name || (staerke > 0 ? "Rechtskurve" : "Linkskurve"), ein, halte, aus, kurve: staerke, auf, dehnbar: false };
  }

  /*
   * Möwenkap: Küstenrunde in der Abenddämmerung, im Uhrzeigersinn.
   * Start mitten auf der Zielgeraden, ein schneller Rechtsbogen den Hang hinauf, die lange
   * Klippengerade mit zwei Kuppen, eine Schikane, die Haarnadel am Leuchtturm, S-Kurven
   * hinunter zum Hafen und der lange Zielbogen.
   */
  const MOEWENKAP = {
    id: "moewenkap",
    name: "Möwenkap",
    kurz: "Küste in der Abenddämmerung",
    sonne: -40,                 // Richtung der Sonne in Grad, von der Zielgeraden aus gemessen (links negativ)
    // Kulisse: ferne Berge mit offenem Meer unter der Sonne, eine Hafenstadt, nahe Hügel
    kulisse: { himmelskoerper: "sonne", wolken: true, sterne: 150, fern: "berge", meer: true, mitte: "stadt", nah: "huegel" },
    farben: {
      // Himmel von oben nach unten: tiefes Nachtblau, Violett, Malve, warmer Streifen am Horizont
      himmel: [[0.00, "#0a0a1d"], [0.42, "#1b1438"], [0.72, "#3a2048"], [0.90, "#6a3446"], [1.00, "#8a4a44"]],
      sonne: "#b4714c",
      dunst: "#3a2a44",         // Nebelfarbe am Horizont
      wolke: "#2a1d40",
      wolkenKante: "#7c4a52",   // von unten angestrahlter Wolkensaum
      stern: "#8d8eb2",
      berge: "#251a36",
      huegel: "#171226",
      // Wechselfarben mit kleinem Helligkeitsunterschied (Flimmerschutz, siehe tests/strecke.mjs)
      gras: ["#1a2e25", "#192c23"],
      randstein: ["#6a3433", "#5d4b49"],
      strasse: ["#33323d", "#31303b"],
      linie: "#5f5c66",          // Randlinie innen an den Randsteinen
      ziel: ["#57545e", "#2c2b34"],
      stadt: "#1d1530",          // Hafenstadt im Dunst
      fenster: "#a87a4c",        // warme Fenster, ruhig, ohne Flackern
      meer: "#241c3c",
      deko: {
        laub: ["#0e1715", "#15221e", "#1e2f28"], stamm: ["#18121a", "#271d24", "#3a2b2e"],
        stein: ["#1a1722", "#272230", "#383040"], kante: "#7a4c46", metall: ["#121118", "#26232e"],
        lampe: "#c79a62", schein: "#a06e3e", tafel: "#17161e", pfeil: "#8a6a40",
        wand: ["#1e1b29", "#2b2738", "#3a3448"], dach: "#15131c", menge: ["#4a3a40", "#3c4250", "#4c4232", "#3d3448", "#4a3030"],
        turm: ["#2c2632", "#5a3434"],
      },
    },
    // Deko: Füllung nah (Hindernisse, spärlich) und fern (dicht), dazu feste Stellen
    deko: {
      samen: 11,
      nah: { arten: { palme: 3, fels: 2 }, abstand: [16, 34], x: [1.75, 2.25] },
      fern: { arten: { palme: 5, fels: 2 }, abstand: [3, 8], x: [2.7, 8] },
      stellen: [
        { stueck: "Hafenmole", art: "laterne", jede: 14, x: 1.8, seiten: [-1, 1] },
        { stueck: "Haarnadel am Leuchtturm", art: "leuchtturm", bei: 0.45, x: -7.5 },
        { stueck: "Leuchtturmweg", art: "fels", jede: 9, x: [2.7, 3.6], seiten: [-1] },
      ],
    },
    stuecke: [
      gerade(70, 0, "Zielgerade, zweite Hälfte", true),
      kurve(30, 42, 30, 3.6, 1800, "Möwenbogen"),
      gerade(70, 2600, "Hang"),
      kurve(25, 11, 25, -1.6, 2600, "Klippenknick"),
      gerade(95, 5600, "Klippengerade, erste Kuppe"),
      gerade(85, 2200),
      gerade(80, 4200, "Klippengerade, zweite Kuppe"),
      gerade(80, 1800, "Klippengerade, Auslauf", true),
      kurve(8, 6, 8, -5.5, 1800, "Schikane links"),
      kurve(8, 6, 8, 5.5, 1800, "Schikane rechts"),
      gerade(50, 1400),
      kurve(20, 56, 20, 4.2, 1000, "Bucht"),
      gerade(250, 3800, "Leuchtturmweg"),
      gerade(280, 2000),
      kurve(14, 51, 14, 8.0, 2000, "Haarnadel am Leuchtturm"),
      gerade(70, 900, "Abfahrt"),
      kurve(15, 50, 15, -4.0, 400, "Hafenkurve"),
      gerade(200, 400, "Hafenmole"),
      kurve(15, 20, 15, -3.8, 0, "Hafen-S links"),
      kurve(15, 20, 15, 3.8, -400, "Hafen-S rechts"),
      gerade(190, 2400, "Kuppe am Hafen"),
      gerade(130, 0),
      kurve(25, 40, 25, 4.0, 0, "Zielbogen"),
      gerade(45, 0, "Zielgerade, erste Hälfte"),
    ],
  };

  /*
   * Mondsenke: Wüste in der Nacht unter Sternen, im Uhrzeigersinn.
   * Schnell und weit: lange Dünenwellen, die Salzseegerade, eine Kehre unter dem Tafelberg
   * und ein enges S zwischen Felsen. Kaum Licht außer Mond und Sternen, nur am Start Laternen.
   */
  const MONDSENKE = {
    id: "mondsenke",
    name: "Mondsenke",
    kurz: "Wüste in der Nacht unter Sternen",
    sonne: 55,                  // hier der Mond
    kulisse: { himmelskoerper: "mond", wolken: false, sterne: 760, milchstrasse: true, fern: "tafelberge", mitte: "duenen", nah: "duenenNah" },
    farben: {
      himmel: [[0.00, "#04050c"], [0.45, "#090c1f"], [0.80, "#141a33"], [0.94, "#1f2440"], [1.00, "#282a45"]],
      sonne: "#8e93ad",         // Mondscheibe, gedämpft
      dunst: "#1b1d33",
      wolke: "#141830",
      wolkenKante: "#3a4060",
      stern: "#9a9fc0",
      berge: "#15162a",
      huegel: "#1e1d2d",
      gras: ["#2a2632", "#28242f"],      // Sand im Mondlicht
      randstein: ["#3c3d50", "#373848"],
      strasse: ["#24242d", "#22222b"],
      linie: "#3e3f4e",
      ziel: ["#4a4a58", "#25252e"],
      duenen: "#221f30",
      fenster: "#a07446",
      deko: {
        laub: ["#121a1a", "#1a2624", "#26352f"], stamm: ["#16131a", "#221d25", "#302830"],
        stein: ["#1c1a26", "#272432", "#353244"], kante: "#46506a", metall: ["#111018", "#24222c"],
        lampe: "#c09060", schein: "#946840", tafel: "#15151d", pfeil: "#7e6842",
        wand: ["#1c1b28", "#282737", "#363548"], dach: "#121119", menge: ["#3a3a4c", "#463c3c", "#3a4440", "#40384c", "#4a4436"],
        turm: ["#26242e", "#4a3434"],
      },
    },
    deko: {
      samen: 23,
      nah: { arten: { kaktus: 3, fels: 2 }, abstand: [14, 30], x: [1.75, 2.3] },
      fern: { arten: { kaktus: 4, fels: 3 }, abstand: [4, 10], x: [2.7, 9] },
      stellen: [
        { stueck: "Felsentor", art: "fels", jede: 4, x: [2.0, 2.8], seiten: [-1, 1] },
        { stueck: "Wüsten-S links", art: "fels", jede: 5, x: [2.6, 3.4], seiten: [-1, 1] },
      ],
    },
    stuecke: [
      gerade(110, 0, "Zielgerade, zweite Hälfte"),
      gerade(267, 700, "Salzpfanne", true),
      kurve(30, 60, 30, 2.6, 400, "Sandbogen"),
      gerade(190, 1400, "Dünenpiste"),
      kurve(25, 30, 25, 1.8, 600, "Dünenschwung rechts"),
      gerade(170, -500, "Dünental", true),
      kurve(25, 30, 25, -1.8, 400, "Dünenschwung links"),
      gerade(170, 1800, "Kamm der Wanderdüne"),
      kurve(14, 40, 14, 6.8, 1600, "Kaktuskehre"),
      gerade(220, 600),
      kurve(16, 30, 16, -4.6, 300, "Felsentor"),
      kurve(20, 40, 20, 3.4, 0, "Salzseebogen"),
      gerade(310, 0, "Salzseegerade"),
      kurve(12, 40, 12, 7.2, 400, "Mondkehre"),
      gerade(150, 2000, "Anstieg zum Tafelberg"),
      kurve(25, 30, 25, -2.8, 2200, "Tafelbergknick"),
      gerade(190, 800),
      kurve(10, 9, 10, 6.4, 600, "Wüsten-S rechts"),
      kurve(10, 9, 10, -6.4, 400, "Wüsten-S links"),
      gerade(200, 0),
      kurve(25, 50, 25, 4.0, 0, "Zielbogen"),
      gerade(60, 0, "Zielgerade, erste Hälfte"),
    ],
  };

  /*
   * Tannenjoch: Bergwald im letzten Licht, gegen den Uhrzeigersinn.
   * Steil hinauf zum Waldkamm, zwei Kehren, die Haarnadel am Joch, dann durchs Tal am Bach
   * und durch ein kleines Dorf mit warmen Fenstern zurück zur Linie.
   */
  const TANNENJOCH = {
    id: "tannenjoch",
    name: "Tannenjoch",
    kurz: "Bergwald im letzten Licht",
    sonne: 150,                 // die Sonne ist hinter den Gipfeln versunken, nur ihr Schein steht noch
    kulisse: { himmelskoerper: "abendrot", wolken: true, sterne: 70, fern: "gipfel", mitte: "waldkamm", nah: "waldhuegel" },
    farben: {
      himmel: [[0.00, "#090d1a"], [0.40, "#16192e"], [0.70, "#2c2438"], [0.88, "#5a3a3a"], [1.00, "#7a4c38"]],
      sonne: "#a8683e",
      dunst: "#2c2534",
      wolke: "#1e1a2e",
      wolkenKante: "#6e4438",
      stern: "#8a8cab",
      berge: "#1d1a2c",
      huegel: "#121a1a",
      gras: ["#16231c", "#15211a"],
      randstein: ["#64382f", "#554641"],
      strasse: ["#2d2c35", "#2b2a33"],
      linie: "#5a5860",
      ziel: ["#52505a", "#2a2932"],
      wald: "#141b1f",
      schnee: "#4c4a5a",
      fenster: "#b07c48",
      deko: {
        laub: ["#0c1513", "#12201b", "#1a2c24"], stamm: ["#17110f", "#251b17", "#36281f"],
        stein: ["#1a1820", "#27242c", "#37323c"], kante: "#7a4a36", metall: ["#121117", "#25222b"],
        lampe: "#c8935a", schein: "#a06a3a", tafel: "#16151c", pfeil: "#8e6a3c",
        wand: ["#231a18", "#33251f", "#433028"], dach: "#141016", menge: ["#4a3a3a", "#3a4048", "#4a4434", "#3c3448", "#4a3428"],
        turm: ["#2a2430", "#553232"],
      },
    },
    deko: {
      samen: 37,
      nah: { arten: { tanne: 4, fels: 1 }, abstand: [12, 26], x: [1.75, 2.3] },
      fern: { arten: { tanne: 9, fels: 1 }, abstand: [1, 3], x: [2.7, 7.5] },
      stellen: [
        { stueck: "Dorfgerade", art: "huette", jede: 18, x: [3.3, 3.9], seiten: [1, -1] },
        { stueck: "Dorfgerade", art: "laterne", jede: 12, x: 1.8, seiten: [-1, 1] },
        { stueck: "Talweg", art: "laterne", jede: 20, x: 1.8, seiten: [1] },
      ],
      lichtung: ["Dorfgerade"], // hier kein dichter Wald
    },
    stuecke: [
      gerade(100, 0, "Zielgerade, zweite Hälfte"),
      kurve(20, 48, 20, -4.5, 1500, "Sägewerkkurve"),
      gerade(190, 4000, "Steile Rampe"),
      kurve(14, 44, 14, 7.4, 4300, "Jägerkehre"),
      gerade(40, 4700, "Zwischen den Kehren"),
      kurve(14, 44, 14, -7.6, 5100, "Kapellenkehre"),
      gerade(170, 5600, "Waldkamm"),
      kurve(25, 96, 25, -3.0, 5600, "Langer Bogen"),
      gerade(250, 4900, "Waldkamm, Abfahrt"),
      gerade(246, 4200, "Waldkamm, untere Abfahrt", true),
      kurve(12, 60, 12, -8.0, 3600, "Haarnadel am Joch"),
      gerade(200, 2400, "Talsenke"),
      kurve(15, 50, 15, 6.2, 1800, "Bachbogen"),
      kurve(15, 50, 15, -6.4, 1200, "Mühlenbogen"),
      gerade(200, 1000, "Talweg"),
      gerade(196, 600, "Talweg, am Bach", true),
      kurve(25, 64, 25, -3.6, 0, "Dorfkurve"),
      gerade(130, 0, "Dorfgerade"),
      kurve(20, 48, 20, -3.5, 0, "Zielkurve"),
      gerade(80, 0, "Zielgerade, erste Hälfte"),
    ],
  };

  // Segmente aus einem Bauplan; laengen[i] ersetzt die Haltelänge von Stück i (zum Dehnen)
  function segmenteBauen(plan, laengen) {
    const L = KONST.SEGMENT_LAENGE;
    const segmente = [];
    const stuecke = [];
    let y = 0;
    plan.stuecke.forEach((st, i) => {
      const halte = laengen && laengen[i] != null ? laengen[i] : st.halte;
      const anzahl = st.ein + halte + st.aus;
      const vonY = y;
      const nachY = st.auf == null ? y : st.auf;
      const erstes = segmente.length;
      for (let n = 0; n < anzahl; n++) {
        let k;
        if (n < st.ein) k = st.kurve * sanft((n + 0.5) / st.ein);
        else if (n < st.ein + halte) k = st.kurve;
        else k = st.kurve * sanft(1 - (n - st.ein - halte + 0.5) / st.aus);
        const y2 = vonY + (nachY - vonY) * sanft((n + 1) / anzahl);
        const nr = segmente.length;
        segmente.push({ nr, z1: nr * L, z2: (nr + 1) * L, kurve: k, y1: y, y2, stueck: i });
        y = y2;
      }
      stuecke.push({ name: st.name, von: erstes, bis: segmente.length, kurve: st.kurve, dehnbar: st.dehnbar, halte });
    });
    return { segmente, stuecke };
  }

  // Draufsicht: Die Richtung wächst mit dem Kurvenwert, so skaliert, dass eine Runde genau eine Umdrehung ist
  // (im Uhrzeigersinn +2π, gegen ihn -2π). Liefert je Segment den Anfangspunkt und die Richtung,
  // dazu den Punkt nach dem letzten Segment.
  function karteBerechnen(segmente) {
    const L = KONST.SEGMENT_LAENGE;
    const summe = segmente.reduce((s, g) => s + g.kurve, 0);
    const proKurve = (2 * Math.PI) / Math.abs(summe); // Bogenmaß je Kurveneinheit und Segment
    const punkte = [];
    let richtung = 0, x = 0, y = 0;
    for (const g of segmente) {
      punkte.push({ x, y, richtung });
      const mitte = richtung + g.kurve * proKurve / 2;
      x += L * Math.sin(mitte);
      y += L * Math.cos(mitte);
      richtung += g.kurve * proKurve;
    }
    return { punkte, ende: { x, y, richtung }, proKurve };
  }

  // Kleiner, fester Zufallsgenerator (mulberry32), damit die Deko jedes Mal gleich steht
  function zufallAus(samen) {
    let s = samen >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /*
   * Deko setzen. Jedes Stück Deko: { art, seg, z, x, spiegel, breite }
   *   x       Querlage der Mitte in halben Fahrbahnbreiten (negativ links)
   *   spiegel Bild gespiegelt (Schild zeigt nach links, Laterne rechts der Straße mit Arm nach links)
   * Reihenfolge: Start-Ziel-Brücke, Tribünen und Laternen an der Zielgeraden, Pfeiltafeln vor
   * engen Kurven, feste Stellen aus dem Bauplan, dann zufällige Füllung nah und fern.
   */
  function dekoBauen(plan, segmente, stuecke) {
    const L = KONST.SEGMENT_LAENGE, anzahl = segmente.length;
    const regel = plan.deko || {};
    const zufall = zufallAus(regel.samen || 1);
    const liste = [];
    const rund = (seg) => ((seg % anzahl) + anzahl) % anzahl;
    function setze(art, seg, x, extra) {
      const s = rund(Math.round(seg));
      const d = Object.assign({ art, seg: s, z: (s + 0.5) * L, x, spiegel: false, breite: DEKO_BREITE[art] || 0 }, extra);
      liste.push(d);
      return d;
    }
    // Abstand in Segmenten über die Ziellinie hinweg
    const segAbstand = (a, b) => { const d = Math.abs(a - b) % anzahl; return Math.min(d, anzahl - d); };
    // Ist an dieser Stelle schon etwas, das zu nahe stünde?
    function frei(seg, x, art) {
      const breit = DEKO_BREITE[art] || 0.3;
      for (const d of liste) {
        if (Math.sign(d.x) !== Math.sign(x) && d.art !== "bruecke") continue;
        const dSeg = segAbstand(d.seg, seg);
        if (d.art === "tribuene" || d.art === "huette" || d.art === "leuchtturm") { if (dSeg < 9 && Math.abs(d.x - x) < 2.6) return false; continue; }
        if (d.art === "bruecke") { if (dSeg < 6 && Math.abs(x) < 4) return false; continue; }
        if (dSeg < 3 && Math.abs(d.x - x) < (breit + d.breite) / 2 + 0.6) return false;
      }
      return true;
    }
    const stueckVon = (name) => stuecke.find((s) => s.name === name);

    // Start-Ziel-Brücke über der Linie; ihre Pfeiler sind die Hindernisse, das Bild zeichnet die Brücke im Ganzen
    setze("bruecke", 0, 0);
    setze("pfeiler", 0, -1.62, { unsichtbar: true });
    setze("pfeiler", 0, 1.62, { unsichtbar: true });
    // Zielgerade: Tribünen rechts, Laternen links (Arm zur Straße)
    for (let k = 9; k <= 57; k += 8) setze("tribuene", -k, 3.5);
    for (let k = 6; k <= 66; k += 12) setze("laterne", -k, -1.8);
    // Pfeiltafeln außen vor engen Kurven: drei Stück vor dem Einlenken
    for (const st of stuecke) {
      if (Math.abs(st.kurve) < 3.5) continue;
      const aussen = -Math.sign(st.kurve);
      for (const k of [-14, -8, -2]) setze("schild", st.von + k, aussen * 1.95, { spiegel: st.kurve < 0 });
    }
    // Feste Stellen aus dem Bauplan
    for (const s of regel.stellen || []) {
      const st = stueckVon(s.stueck);
      if (!st) throw new Error(plan.name + ": Stück für Deko fehlt: " + s.stueck);
      const xWert = () => (Array.isArray(s.x) ? s.x[0] + zufall() * (s.x[1] - s.x[0]) : s.x);
      if (s.bei != null) { setze(s.art, st.von + s.bei * (st.bis - st.von), s.x); continue; }
      for (let seg = st.von + 2; seg < st.bis - 1; seg += s.jede) {
        for (const seite of s.seiten) {
          // mehrere Seiten: abwechselnd versetzt, damit nicht immer zwei nebeneinander stehen
          const versatz = s.seiten.length > 1 && seite > 0 ? Math.floor(s.jede / 2) : 0;
          const x = seite * xWert();
          if (frei(seg + versatz, x, s.art)) setze(s.art, seg + versatz, x, { spiegel: s.art === "laterne" && seite > 0 });
        }
      }
    }
    // Zufällige Füllung, zuerst nah (Hindernisse), dann fern
    const imStart = (seg) => seg > anzahl - KONST.START_FREI[0] || seg < KONST.START_FREI[1];
    const lichtung = (regel.lichtung || []).map(stueckVon).filter(Boolean);
    const inLichtung = (seg) => lichtung.some((st) => seg >= st.von - 6 && seg < st.bis + 6);
    function waehle(arten) {
      const eintraege = Object.entries(arten);
      let w = zufall() * eintraege.reduce((s, [, g]) => s + g, 0);
      for (const [art, g] of eintraege) { if ((w -= g) < 0) return art; }
      return eintraege[0][0];
    }
    for (const [band, nah] of [[regel.nah, true], [regel.fern, false]]) {
      if (!band) continue;
      for (const seite of [-1, 1]) {
        let seg = Math.floor(zufall() * band.abstand[1]);
        while (seg < anzahl) {
          const art = waehle(band.arten);
          const x = seite * (band.x[0] + zufall() * (band.x[1] - band.x[0]));
          const sperre = (nah && imStart(seg)) || (inLichtung(seg) && (nah || zufall() < 0.85));
          if (!sperre && frei(seg, x, art)) setze(art, seg, x);
          seg += band.abstand[0] + Math.floor(zufall() * (band.abstand[1] - band.abstand[0] + 1));
        }
      }
    }
    liste.sort((a, b) => a.seg - b.seg || a.x - b.x);
    return liste;
  }

  // Hindernisse je Segment: jedes feste Stück Deko nahe der Fahrbahn gilt auf seinem Segment und den beiden Nachbarn
  function hindernisseBauen(deko, anzahl) {
    const je = Array.from({ length: anzahl }, () => null);
    for (const d of deko) {
      if (!d.breite || Math.abs(d.x) - d.breite / 2 > KONST.HINDERNIS_BIS) continue;
      for (const k of [-1, 0, 1]) {
        const s = (d.seg + k + anzahl) % anzahl;
        (je[s] || (je[s] = [])).push(d);
      }
    }
    return je;
  }

  // Baut eine Strecke aus einem Bauplan und schließt sie auf der Karte über die zwei dehnbaren Geraden
  function baue(plan) {
    const L = KONST.SEGMENT_LAENGE;
    let { segmente, stuecke } = segmenteBauen(plan);
    const dehnbar = stuecke.map((s, i) => (s.dehnbar ? i : -1)).filter((i) => i >= 0);
    if (dehnbar.length === 2) {
      const k = karteBerechnen(segmente);
      const [a, b] = dehnbar;
      const ra = k.punkte[stuecke[a].von].richtung, rb = k.punkte[stuecke[b].von].richtung;
      // Gesucht: na, nb Segmente mehr, sodass ende + L * (na * (sin ra, cos ra) + nb * (sin rb, cos rb)) = 0
      const ax = Math.sin(ra), ay = Math.cos(ra), bx = Math.sin(rb), by = Math.cos(rb);
      const det = ax * by - ay * bx;
      if (Math.abs(det) < 0.2) throw new Error(plan.name + ": dehnbare Geraden fast parallel, Runde lässt sich so nicht schließen");
      const ex = -k.ende.x / L, ey = -k.ende.y / L;
      const na = Math.round((ex * by - ey * bx) / det);
      const nb = Math.round((ax * ey - ay * ex) / det);
      const laengen = plan.stuecke.map(() => null);
      laengen[a] = plan.stuecke[a].halte + na;
      laengen[b] = plan.stuecke[b].halte + nb;
      if (laengen[a] < KONST.MIN_GERADE || laengen[b] < KONST.MIN_GERADE) {
        throw new Error(plan.name + ": zum Schließen müsste eine dehnbare Gerade kürzer als " + KONST.MIN_GERADE + " Segmente werden (" + laengen[a] + ", " + laengen[b] + ")");
      }
      ({ segmente, stuecke } = segmenteBauen(plan, laengen));
    }
    const karte = karteBerechnen(segmente);
    const anzahl = segmente.length;
    const laenge = anzahl * L;
    const deko = dekoBauen(plan, segmente, stuecke);
    const hindernisse = hindernisseBauen(deko, anzahl);

    // Segment an einer Stelle z (z darf über die Runde hinaus oder negativ sein)
    function segment(z) {
      const n = Math.floor(z / L) % anzahl;
      return segmente[n < 0 ? n + anzahl : n];
    }
    // Höhe der Straße an der Stelle z, linear im Segment
    function hoeheBei(z) {
      const g = segment(z);
      const t = (((z % L) + L) % L) / L;
      return g.y1 + (g.y2 - g.y1) * t;
    }
    // Fahrtrichtung auf der Karte an der Stelle z (Bogenmaß, 0 ist die Richtung der Zielgeraden)
    function richtungBei(z) {
      const g = segment(z);
      const t = (((z % L) + L) % L) / L;
      return karte.punkte[g.nr].richtung + g.kurve * karte.proKurve * t;
    }
    return {
      id: plan.id,
      name: plan.name,
      kurz: plan.kurz,
      kulisse: plan.kulisse || {},
      farben: plan.farben,
      sonne: plan.sonne,
      segmente,
      stuecke,
      karte,
      anzahl,
      laenge,
      breite: KONST.BREITE,
      randstein: KONST.RANDSTEIN,
      streifen: KONST.STREIFEN,
      deko,
      hindernisse,
      segment,
      hoeheBei,
      richtungBei,
    };
  }

  return {
    KONST,
    sanft,
    gerade,
    kurve,
    baue,
    karteBerechnen,
    DEKO_BREITE,
    PLAENE: { moewenkap: MOEWENKAP, mondsenke: MONDSENKE, tannenjoch: TANNENJOCH },
    REIHE: ["moewenkap", "mondsenke", "tannenjoch"],
  };
});
