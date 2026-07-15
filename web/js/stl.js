// Binär STL-export. Geometrierna är redan i mm med Z uppåt.

export function exportSTL(geometries, filename) {
  let triCount = 0;
  const posArrays = geometries.map((g) => {
    const attr = g.getAttribute("position");
    triCount += attr.count / 3;
    return attr.array;
  });
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  new Uint8Array(buf, 0, 80).set(new TextEncoder().encode("Inequality3D"));
  dv.setUint32(80, triCount, true);
  let off = 84;
  for (const arr of posArrays) {
    for (let i = 0; i < arr.length; i += 9) {
      const ax = arr[i], ay = arr[i + 1], az = arr[i + 2];
      const bx = arr[i + 3], by = arr[i + 4], bz = arr[i + 5];
      const cx = arr[i + 6], cy = arr[i + 7], cz = arr[i + 8];
      // normal
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(off, nx / l, true);
      dv.setFloat32(off + 4, ny / l, true);
      dv.setFloat32(off + 8, nz / l, true);
      const pts = [ax, ay, az, bx, by, bz, cx, cy, cz];
      for (let k = 0; k < 9; k++) dv.setFloat32(off + 12 + k * 4, pts[k], true);
      dv.setUint16(off + 48, 0, true);
      off += 50;
    }
  }
  const blob = new Blob([buf], { type: "model/stl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
