/**
 * Turns a product photo on a white (or near-white) background into a transparent cut-out,
 * without touching the bottle itself: pixels are made transparent ONLY if they are near-white AND
 * connected to the image border through other near-white pixels (a flood fill from the edges).
 * A white label inside the bottle is enclosed by glass, so it is never reached and stays opaque.
 * The edge gets a one-pixel feather so the cut-out does not look pasted.
 *
 * Nothing is redrawn, recoloured or generated: the bottle's own pixels are kept exactly.
 */

/** @param {Uint8Array|Buffer} rgba  width*height*4 RGBA bytes (modified copy returned) */
export function cutout(rgba, width, height, { tolerance = 30 } = {}) {
  const data = Uint8Array.from(rgba);
  const n = width * height;
  const distance = (i) => {
    const o = i * 4;
    return Math.max(255 - data[o], 255 - data[o + 1], 255 - data[o + 2]);
  };
  const background = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (i) => {
    if (background[i]) return;
    const o = i * 4;
    // Already-transparent pixels count as background too (a photo that is partly cut out).
    if (data[o + 3] < 16 || distance(i) <= tolerance) {
      background[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) seed(i - 1);
    if (x < width - 1) seed(i + 1);
    if (y > 0) seed(i - width);
    if (y < height - 1) seed(i + width);
  }

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (background[i]) {
      data[o + 3] = 0;
      continue;
    }
    // Feather: an opaque pixel touching the background becomes partly transparent if it is
    // itself light (the anti-aliased rim of the photo), so the edge does not show a white halo.
    const x = i % width;
    const y = (i - x) / width;
    const touches =
      (x > 0 && background[i - 1]) || (x < width - 1 && background[i + 1]) || (y > 0 && background[i - width]) || (y < height - 1 && background[i + width]);
    if (touches) data[o + 3] = Math.min(data[o + 3], Math.round(255 * Math.min(1, distance(i) / (tolerance * 3))));
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const box = maxX < 0 ? null : { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return { data, box };
}
