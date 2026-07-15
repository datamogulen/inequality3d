// Textkonturer för gravyr, via opentype.js (Open Sans Bold, OFL/Apache).

import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import * as opentype from "opentype.js";
// webbläsaren laddar ESM-bygget (namngivna exporter), Node CJS-bygget (default)
const parseFont = opentype.parse ?? opentype.default.parse;

let fontPromise = null;

export function loadFont() {
  if (!fontPromise) {
    fontPromise = fetch("fonts/OpenSans-Bold.ttf")
      .then((r) => r.arrayBuffer())
      .then((buf) => parseFont(buf));
  }
  return fontPromise;
}

// Returnerar { shapes: THREE.Shape[], width } – konturer i mm, centrerade
// kring origo, SPEGLADE i x så att texten läses rättvänt underifrån.
export function textShapes(font, text, sizeMm) {
  const path = font.getPath(text, 0, 0, sizeMm);
  const sp = new THREE.ShapePath();
  let cur = null;
  for (const c of path.commands) {
    // opentype har y nedåt → flippa y; spegla x för undersidan
    const X = (x) => -x, Y = (y) => -y;
    switch (c.type) {
      case "M": cur = new THREE.Path(); cur.moveTo(X(c.x), Y(c.y)); sp.subPaths.push(cur); break;
      case "L": cur.lineTo(X(c.x), Y(c.y)); break;
      case "Q": cur.quadraticCurveTo(X(c.x1), Y(c.y1), X(c.x), Y(c.y)); break;
      case "C": cur.bezierCurveTo(X(c.x1), Y(c.y1), X(c.x2), Y(c.y2), X(c.x), Y(c.y)); break;
      case "Z": if (cur) cur.closePath(); break;
    }
  }
  const shapes = SVGLoader.createShapes(sp);
  // centrera
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of shapes) {
    for (const p of s.getPoints(12)) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  if (!shapes.length) return { shapes: [], width: 0 };
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // Mikro-jitter per glyf (~0,3 µm): bryter exakt kollinjäritet mellan olika
  // bokstävers bas-/versallinjer, som annars ger T-korsningar när earcut
  // bryggar ihop hålen vid extrudering.
  shapes.forEach((s, i) => {
    const jx = ((i * 7) % 11 - 5) * 6e-5, jy = ((i * 5) % 13 - 6) * 6e-5;
    const m = new THREE.Matrix3().set(1, 0, -cx + jx, 0, 1, -cy + jy, 0, 0, 1);
    const move = (path) => {
      for (const curve of path.curves) {
        for (const key of ["v0", "v1", "v2", "v3"]) {
          if (curve[key]) curve[key].applyMatrix3(m);
        }
      }
      if (path.currentPoint) path.currentPoint.applyMatrix3(m);
    };
    move(s);
    s.holes.forEach(move);
  });
  return { shapes, width: maxX - minX, height: maxY - minY };
}
