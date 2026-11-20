// News infographic for 19 November 2026.
// Pure Node.js standard library only. No network, no dependencies.
// Hand-rolled PNG encoder (palette image, fixed-Huffman DEFLATE + LZ77,
// CRC32, Adler-32) and a hand-written 5x7 bitmap font. Fully deterministic:
// two runs produce byte-identical output.
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// CRC32 (polynomial 0xEDB88320), table built at runtime.
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// ---------------------------------------------------------------------------
// DEFLATE with fixed Huffman codes and a greedy LZ77 matcher.
// ---------------------------------------------------------------------------
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

// Fixed-Huffman code for a literal/length symbol. Returns [code, bitLength].
function litLenCode(sym) {
  if (sym <= 143) return [0x30 + sym, 8];
  if (sym <= 255) return [0x190 + (sym - 144), 9];
  if (sym <= 279) return [sym - 256, 7];
  return [0xc0 + (sym - 280), 8];
}

function lenSymbol(len) {
  if (len === 258) return 285;
  for (let s = 0; s < 28; s++) {
    const max = LEN_BASE[s] + ((1 << LEN_EXTRA[s]) - 1);
    if (len >= LEN_BASE[s] && len <= max) return 257 + s;
  }
  throw new Error("bad match length " + len);
}

function distSymbol(d) {
  for (let s = 0; s < 30; s++) {
    const max = DIST_BASE[s] + ((1 << DIST_EXTRA[s]) - 1);
    if (d >= DIST_BASE[s] && d <= max) return s;
  }
  throw new Error("bad match distance " + d);
}

function deflateFixed(data) {
  const out = [];
  let bitBuf = 0;
  let bitCnt = 0;
  const putBit = (b) => {
    bitBuf |= (b & 1) << bitCnt;
    bitCnt++;
    if (bitCnt === 8) {
      out.push(bitBuf);
      bitBuf = 0;
      bitCnt = 0;
    }
  };
  // Extra-field and header bits go out least-significant bit first.
  const putBits = (val, n) => {
    for (let i = 0; i < n; i++) putBit((val >> i) & 1);
  };
  // Huffman codes go out most-significant bit first.
  const putCode = (code, len) => {
    for (let i = len - 1; i >= 0; i--) putBit((code >> i) & 1);
  };
  const emitLit = (sym) => {
    const [c, l] = litLenCode(sym);
    putCode(c, l);
  };
  const emitLenDist = (len, dist) => {
    const sym = lenSymbol(len);
    const [c, l] = litLenCode(sym);
    putCode(c, l);
    const li = sym - 257;
    if (LEN_EXTRA[li] > 0) putBits(len - LEN_BASE[li], LEN_EXTRA[li]);
    const dsym = distSymbol(dist);
    putCode(dsym, 5);
    if (DIST_EXTRA[dsym] > 0) putBits(dist - DIST_BASE[dsym], DIST_EXTRA[dsym]);
  };

  // Block header: BFINAL=1, BTYPE=01 (fixed Huffman).
  putBit(1);
  putBits(0b01, 2);

  const n = data.length;
  const head = new Int32Array(65536).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const hashAt = (i) => ((data[i] * 257 + data[i + 1]) * 257 + data[i + 2]) & 0xffff;

  let i = 0;
  while (i < n) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + 2 < n) {
      let cand = head[hashAt(i)];
      let tries = 0;
      while (cand !== -1 && tries < 24) {
        const dist = i - cand;
        if (dist > 32768) break;
        let len = 0;
        while (len < 258 && i + len < n && data[cand + len] === data[i + len]) len++;
        if (len >= 3 && len > bestLen) {
          bestLen = len;
          bestDist = dist;
          if (len === 258) break;
        }
        cand = prev[cand];
        tries++;
      }
    }
    if (bestLen >= 3) {
      emitLenDist(bestLen, bestDist);
      const end = i + bestLen;
      for (let j = i; j < end; j++) {
        if (j + 2 < n) {
          const h = hashAt(j);
          prev[j] = head[h];
          head[h] = j;
        }
      }
      i = end;
    } else {
      emitLit(data[i]);
      if (i + 2 < n) {
        const h = hashAt(i);
        prev[i] = head[h];
        head[h] = i;
      }
      i++;
    }
  }
  emitLit(256); // End of block.
  if (bitCnt > 0) out.push(bitBuf);
  return Buffer.from(out);
}

function zlibWrap(raw) {
  const deflated = deflateFixed(raw);
  const out = Buffer.alloc(2 + deflated.length + 4);
  out[0] = 0x78;
  out[1] = 0x9c;
  deflated.copy(out, 2);
  out.writeUInt32BE(adler32(raw), 2 + deflated.length);
  return out;
}

// ---------------------------------------------------------------------------
// PNG encoder: 8-bit palette image, color type 3.
// ---------------------------------------------------------------------------
function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(w, h, indices, palette) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // color type: palette
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach(([r, g, b], i) => {
    plte[i * 3] = r;
    plte[i * 3 + 1] = g;
    plte[i * 3 + 2] = b;
  });
  // Filter 0 (none) on every scanline.
  const raw = Buffer.alloc(h * (1 + w));
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    raw.set(indices.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
  }
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("PLTE", plte),
    pngChunk("IDAT", zlibWrap(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Hand-written 5x7 bitmap font. Each glyph is 7 rows; each row is a 5-bit
// number, most-significant bit = leftmost pixel.
// ---------------------------------------------------------------------------
const GLYPHS = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 4, 8],
  ":": [0, 12, 12, 0, 12, 12, 0],
  $: [4, 15, 20, 14, 5, 30, 4],
  "%": [25, 26, 2, 4, 8, 11, 19],
  "'": [4, 4, 8, 0, 0, 0, 0],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "/": [1, 2, 2, 4, 8, 8, 16],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "+": [0, 4, 4, 31, 4, 4, 0],
};

function textWidth(str, scale) {
  return str.length * 6 * scale - scale;
}

// ---------------------------------------------------------------------------
// Rasterizer over a palette-index framebuffer.
// ---------------------------------------------------------------------------
class Canvas {
  constructor(w, h, bg) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h).fill(bg);
  }
  set(x, y, c) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  rect(x, y, w, h, c) {
    x = Math.floor(x);
    y = Math.floor(y);
    w = Math.floor(w);
    h = Math.floor(h);
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) {
      const base = yy * this.w;
      for (let xx = x0; xx < x1; xx++) this.px[base + xx] = c;
    }
  }
  circle(cx, cy, r, c) {
    for (let dy = -r; dy <= r; dy++) {
      const dx = Math.floor(Math.sqrt(r * r - dy * dy));
      this.rect(cx - dx, cy + dy, 2 * dx + 1, 1, c);
    }
  }
  line(x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.set(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
  thickLine(x0, y0, x1, y1, t, c) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    const r = Math.floor(t / 2);
    for (let i = 0; i <= steps; i++) {
      this.circle(Math.round(x0 + (dx * i) / steps), Math.round(y0 + (dy * i) / steps), r, c);
    }
  }
  poly(pts, c) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % pts.length];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.ceil(xs[k]);
        const x1 = Math.floor(xs[k + 1]);
        if (x1 >= x0) this.rect(x0, y, x1 - x0 + 1, 1, c);
      }
    }
  }
  star(cx, cy, rOut, rIn, n, c) {
    const pts = [];
    for (let i = 0; i < 2 * n; i++) {
      const r = i % 2 === 0 ? rOut : rIn;
      const a = (i * Math.PI) / n - Math.PI / 2;
      pts.push([Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a))]);
    }
    this.poly(pts, c);
  }
  rotRect(cx, cy, w, h, deg, c) {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const hw = w / 2;
    const hh = h / 2;
    const pts = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(([x, y]) => [Math.round(cx + x * cos - y * sin), Math.round(cy + x * sin + y * cos)]);
    this.poly(pts, c);
  }
  text(x, y, str, scale, c) {
    let cx = Math.floor(x);
    y = Math.floor(y);
    for (const ch of str) {
      const g = GLYPHS[ch];
      if (g === undefined) throw new Error("missing glyph for " + JSON.stringify(ch));
      for (let r = 0; r < 7; r++) {
        const row = g[r];
        for (let col = 0; col < 5; col++) {
          if (row & (16 >> col)) this.rect(cx + col * scale, y + r * scale, scale, scale, c);
        }
      }
      cx += 6 * scale;
    }
    return cx;
  }
}

// ---------------------------------------------------------------------------
// Palette (indices used by the layout below).
// ---------------------------------------------------------------------------
const PALETTE = [
  [248, 244, 236], // 0 cream background
  [18, 43, 69], // 1 navy header
  [28, 28, 28], // 2 ink text
  [255, 255, 255], // 3 white
  [179, 38, 30], // 4 red
  [14, 124, 123], // 5 teal
  [43, 74, 203], // 6 blue
  [199, 125, 10], // 7 ochre
  [47, 125, 50], // 8 green
  [216, 210, 196], // 9 light rule
];
const CREAM = 0;
const NAVY = 1;
const INK = 2;
const WHITE = 3;

// ---------------------------------------------------------------------------
// The five stories of Thursday 19 November 2026, each verified against at
// least two independent news sources (see README.md).
// ---------------------------------------------------------------------------
const STORIES = [
  {
    kicker: "THE HAGUE - WORLD COURT",
    headline: "MYANMAR GUILTY OF GENOCIDE",
    s1: "ICJ: 2017 CRACKDOWN WAS GENOCIDE.",
    s2: "FIRST STATE EVER FOUND GUILTY.",
    accent: 4,
    icon: "gavel",
  },
  {
    kicker: "SHENZHEN - SUMMIT",
    headline: "TRUMP, XI AND PUTIN MEET",
    s1: "FIRST EVER THREE-WAY SUMMIT.",
    s2: "FOUR-POINT PEACE DECLARATION.",
    accent: 5,
    icon: "globe",
  },
  {
    kicker: "WALL STREET - MARKETS",
    headline: "ANTHROPIC IPO SMASHES RECORD",
    s1: "$83 A SHARE. $81.3 BILLION RAISED.",
    s2: "SHARES JUMP AS TRADING BEGINS.",
    accent: 6,
    icon: "chart",
  },
  {
    kicker: "GAZA - MIDDLE EAST",
    headline: "ISRAEL PUSHES INTO GAZA",
    s1: "TANKS CROSS THE YELLOW LINE",
    s2: "NEAR NUSEIRAT. CEASEFIRE STRAINED.",
    accent: 7,
    icon: "tank",
  },
  {
    kicker: "UKRAINE - WAR",
    headline: "CRIMEA BRIDGE HIT AGAIN",
    s1: "FRESH ATTACK ON THE BRIDGE. TRAFFIC SUSPENDED.",
    s2: "ON THE KEY SUPPLY ROUTE.",
    accent: 8,
    icon: "bridge",
  },
];

// ---------------------------------------------------------------------------
// Pictograms: simple shapes in white on the story tile. (tx, ty) is the
// tile's top-left corner; the tile is 136x136.
// ---------------------------------------------------------------------------
function drawPictogram(cv, icon, tx, ty, tile) {
  const W = WHITE;
  if (icon === "gavel") {
    cv.rotRect(tx + 68, ty + 46, 88, 26, -30, W);
    cv.thickLine(tx + 62, ty + 62, tx + 44, ty + 108, 10, W);
    cv.rect(tx + 22, ty + 112, 92, 8, W);
  } else if (icon === "globe") {
    cv.circle(tx + 68, ty + 66, 42, W);
    cv.circle(tx + 68, ty + 66, 34, tile);
    cv.rect(tx + 26, ty + 62, 84, 8, W);
    cv.rect(tx + 64, ty + 24, 8, 84, W);
  } else if (icon === "chart") {
    cv.thickLine(tx + 32, ty + 102, tx + 32, ty + 26, 6, W);
    cv.thickLine(tx + 32, ty + 102, tx + 110, ty + 102, 6, W);
    cv.thickLine(tx + 36, ty + 94, tx + 58, ty + 70, 7, W);
    cv.thickLine(tx + 58, ty + 70, tx + 80, ty + 78, 7, W);
    cv.thickLine(tx + 80, ty + 78, tx + 102, ty + 42, 7, W);
    cv.poly(
      [
        [tx + 112, ty + 30],
        [tx + 96, ty + 44],
        [tx + 104, ty + 54],
      ],
      W,
    );
  } else if (icon === "tank") {
    cv.rect(tx + 28, ty + 64, 80, 30, W);
    cv.rect(tx + 50, ty + 46, 34, 18, W);
    cv.thickLine(tx + 84, ty + 55, tx + 112, ty + 55, 8, W);
    for (const wx of [44, 68, 92]) {
      cv.circle(tx + wx, ty + 98, 9, W);
      cv.circle(tx + wx, ty + 98, 4, tile);
    }
  } else if (icon === "bridge") {
    cv.rect(tx + 34, ty + 38, 10, 66, W);
    cv.rect(tx + 92, ty + 38, 10, 66, W);
    cv.rect(tx + 22, ty + 76, 40, 8, W);
    cv.rect(tx + 74, ty + 76, 40, 8, W);
    cv.star(tx + 68, ty + 66, 22, 9, 8, W);
  }
}

// ---------------------------------------------------------------------------
// Layout: 1024x1024. Header band, five story rows, small source footer.
// ---------------------------------------------------------------------------
const W = 1024;
const H = 1024;

function render() {
  const cv = new Canvas(W, H, CREAM);

  // Header.
  cv.rect(0, 0, W, 148, NAVY);
  const title = "19 NOVEMBER 2026";
  cv.text((W - textWidth(title, 8)) / 2, 34, title, 8, WHITE);
  cv.rect(56, 114, 210, 4, WHITE);
  cv.rect(W - 56 - 210, 114, 210, 4, WHITE);
  const sub = "THE WORLD IN ONE IMAGE";
  cv.text((W - textWidth(sub, 3)) / 2, 102, sub, 3, WHITE);

  // Story rows.
  let y = 168;
  STORIES.forEach((s, idx) => {
    cv.rect(24, y + 8, 136, 136, s.accent);
    drawPictogram(cv, s.icon, 24, y + 8, s.accent);
    cv.text(184, y + 12, s.kicker, 3, s.accent);
    cv.text(184, y + 40, s.headline, 4, INK);
    cv.text(184, y + 78, s.s1, 3, INK);
    cv.text(184, y + 104, s.s2, 3, INK);
    if (idx < STORIES.length - 1) cv.rect(24, y + 158, 976, 2, 9);
    y += 164;
  });

  // Footer.
  const foot = "SOURCES: ICJ - HORIZON - DOW JONES - AL JAZEERA";
  cv.text((W - textWidth(foot, 2)) / 2, 992, foot, 2, INK);

  return cv;
}

function main() {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "./out";
  fs.mkdirSync(outDir, { recursive: true });
  const cv = render();
  const png = encodePNG(W, H, cv.px, PALETTE);
  const outPath = path.join(outDir, "entry.png");
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
}

main();
