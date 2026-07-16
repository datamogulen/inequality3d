// Textkonturer för gravyr, via opentype.js (Open Sans Regular, Apache 2.0).
// Glyferna behålls som THREE-kurvor hela vägen (ingen polygonisering med
// kollinjär-rensning – den förstörde bokstäver, t.ex. E→F). Kurvorna
// triangeliseras först i ExtrudeGeometry.

import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import * as opentype from "opentype.js";
const parseFont = opentype.parse ?? opentype.default.parse;

let fontPromise = null;

export function loadFont() {
  if (!fontPromise) {
    fontPromise = fetch("fonts/OpenSans-Regular.ttf")
      .then((r) => r.arrayBuffer())
      .then((buf) => parseFont(buf));
  }
  return fontPromise;
}

// Glyfshapes för EN rad text, centrerad kring origo. mirror=true speglar i x
// (för text som läses underifrån). Returnerar { shapes, width, height }.
function lineShapes(font, text, sizeMm, mirror) {
  const path = font.getPath(text, 0, 0, sizeMm);
  const sp = new THREE.ShapePath();
  let cur = null;
  const sx = mirror ? -1 : 1;
  const X = (x) => sx * x, Y = (y) => -y; // font-y pekar nedåt → flippa alltid
  for (const c of path.commands) {
    switch (c.type) {
      case "M": cur = new THREE.Path(); cur.moveTo(X(c.x), Y(c.y)); sp.subPaths.push(cur); break;
      case "L": cur.lineTo(X(c.x), Y(c.y)); break;
      case "Q": cur.quadraticCurveTo(X(c.x1), Y(c.y1), X(c.x), Y(c.y)); break;
      case "C": cur.bezierCurveTo(X(c.x1), Y(c.y1), X(c.x2), Y(c.y2), X(c.x), Y(c.y)); break;
      case "Z": if (cur) cur.closePath(); break;
    }
  }
  // Speglad text vänder kurvornas orientering → SVGLoader räknar om hål/ytor
  const shapes = SVGLoader.createShapes(sp);
  const box = bounds(shapes);
  return { shapes, box };
}

function bounds(shapes) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of shapes) {
    for (const p of s.getPoints(8)) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  return { minX, maxX, minY, maxY };
}

// Translerar alla kurvor i en shape (och dess hål) med (dx,dy).
function translateShape(s, dx, dy) {
  const m = new THREE.Matrix3().set(1, 0, dx, 0, 1, dy, 0, 0, 1);
  const move = (path) => {
    for (const curve of path.curves) {
      for (const key of ["v0", "v1", "v2", "v3"]) if (curve[key]) curve[key].applyMatrix3(m);
    }
    if (path.currentPoint) path.currentPoint.applyMatrix3(m);
  };
  move(s);
  s.holes.forEach(move);
}

// En rad, centrerad kring origo. { shapes, width, height }.
export function textShapes(font, text, sizeMm, mirror = true) {
  const { shapes, box } = lineShapes(font, text, sizeMm, mirror);
  if (!shapes.length) return { shapes: [], width: 0, height: 0 };
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  for (const s of shapes) translateShape(s, -cx, -cy);
  return { shapes, width: box.maxX - box.minX, height: box.maxY - box.minY };
}

// Flera rader, staplade i y (rad 0 överst), hela blocket centrerat kring
// origo. lines: [{ text, size }]. mirror gäller hela blocket.
// Vid spegling vänds radordningen i x-led redan av lineShapes; y-stapling
// måste vändas så rad 0 hamnar överst även underifrån (mirror i x, ej y).
export function textBlock(font, lines, mirror = true, lineGap = 1.4) {
  const rows = lines
    .filter((l) => l.text)
    .map((l) => {
      const { shapes, box } = lineShapes(font, l.text, l.size, mirror);
      return { shapes, box, h: box.maxY - box.minY, w: box.maxX - box.minX };
    });
  if (!rows.length) return { shapes: [], width: 0, height: 0, rows: [] };
  const totalH = rows.reduce((s, r) => s + r.h, 0) + lineGap * (rows.length - 1);
  let y = totalH / 2; // överkant
  let maxW = 0;
  const all = [];
  const rowInfo = [];
  for (const r of rows) {
    const cx = (r.box.minX + r.box.maxX) / 2;
    const cyTop = r.box.maxY; // radens överkant i sitt eget koord
    // placera radens överkant vid y
    const dy = y - cyTop;
    for (const s of r.shapes) { translateShape(s, -cx, dy); all.push(s); }
    rowInfo.push({ w: r.w, yTop: y, yBot: y - r.h });
    maxW = Math.max(maxW, r.w);
    y -= r.h + lineGap;
  }
  return { shapes: all, width: maxW, height: totalH, rows: rowInfo };
}
