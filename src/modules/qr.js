// QR code generation (byte mode, EC level M, versions 1-10), implemented
// from the QR specification with zero dependencies. Renders SVG or PNG
// (PNG via node:zlib). Verified against the segno reference encoder.
import zlib from "node:zlib";

// ---- GF(256) arithmetic, primitive polynomial 0x11D ----
const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
function rsGeneratorPoly(degree) {
  // Product of (x + alpha^i) for i in 0..degree-1.
  // Coefficients highest-degree first, leading coefficient 1.
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const r = GF_EXP[i];
    const next = new Array(poly.length + 1).fill(0);
    for (let k = 0; k < next.length; k++) {
      const a = k < poly.length ? poly[k] : 0;
      const b = k - 1 >= 0 && k - 1 < poly.length ? gfMul(r, poly[k - 1]) : 0;
      next[k] = a ^ b;
    }
    poly = next;
  }
  return poly;
}
function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ res[0];
    res.shift();
    res.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return res;
}

// ---- EC level M structure table (versions 1-10) ----
// blocks: [count, totalCodewordsPerBlock, dataCodewordsPerBlock]
const EC_TABLE_M = {
  1: { ec: 10, blocks: [[1, 26, 16]] },
  2: { ec: 16, blocks: [[1, 44, 28]] },
  3: { ec: 26, blocks: [[1, 70, 44]] },
  4: { ec: 18, blocks: [[2, 50, 32]] },
  5: { ec: 24, blocks: [[2, 67, 43]] },
  6: { ec: 16, blocks: [[4, 43, 27]] },
  7: { ec: 18, blocks: [[4, 49, 31]] },
  8: { ec: 22, blocks: [[2, 60, 38], [2, 61, 39]] },
  9: { ec: 22, blocks: [[3, 58, 36], [2, 59, 37]] },
  10: { ec: 26, blocks: [[4, 69, 43], [1, 70, 44]] },
};
const BYTE_CAPACITY_M = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 };
const ALIGNMENT_CENTERS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

function buildDataCodewords(bytes, version) {
  const spec = EC_TABLE_M[version];
  const totalData = spec.blocks.reduce((sum, [count, , dc]) => sum + count * dc, 0);
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4); // byte mode
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  const capacityBits = totalData * 8;
  const terminator = Math.min(4, capacityBits - bits.length);
  for (let i = 0; i < terminator; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (codewords.length < totalData) codewords.push(pads[p++ % 2]);
  return codewords;
}

function interleave(dataCodewords, version) {
  const spec = EC_TABLE_M[version];
  const blocks = [];
  let offset = 0;
  for (const [count, , dataPerBlock] of spec.blocks) {
    for (let i = 0; i < count; i++) {
      const data = dataCodewords.slice(offset, offset + dataPerBlock);
      offset += dataPerBlock;
      blocks.push({ data, ec: rsEncode(data, spec.ec) });
    }
  }
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < spec.ec; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

// ---- Matrix construction ----
function baseMatrix(version) {
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = v; };
  function finder(r0, c0) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inOuter && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(r0 + r, c0 + c, dark ? 1 : 0);
      }
    }
  }
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);
  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    m[6][i] = i % 2 === 0 ? 1 : 0;
    m[i][6] = i % 2 === 0 ? 1 : 0;
  }
  // Alignment patterns (skip only the three finder-corner combinations;
  // patterns centered on the timing lines are drawn over them).
  const centers = ALIGNMENT_CENTERS[version];
  const first = centers[0];
  const last = centers[centers.length - 1];
  for (const r of centers) {
    for (const c of centers) {
      if ((r === first && c === first) || (r === first && c === last) || (r === last && c === first)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          m[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) === 1 ? 0 : 1;
        }
      }
    }
  }
  // Reserve format information cells
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { if (m[8][i] === null) m[8][i] = 0; if (m[i][8] === null) m[i][8] = 0; }
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0;
    if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0;
  }
  // Dark module
  m[size - 8][8] = 1;
  // Reserve version information (versions >= 7)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        m[i][size - 11 + j] = 0;
        m[size - 11 + j][i] = 0;
      }
    }
  }
  return m;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function formatInfoBits(mask) {
  const data = (0b00 << 3) | mask; // EC level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}
function versionInfoBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  return ((version << 12) | rem) & 0x3ffff;
}
function drawFormat(m, mask) {
  const size = m.length;
  const bits = formatInfoBits(mask);
  const bit = (i) => (bits >> i) & 1;
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i <= 14; i++) m[8][14 - i] = bit(i);
  for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = bit(i);
  for (let i = 8; i <= 14; i++) m[size - 15 + i][8] = bit(i);
  m[size - 8][8] = 1;
}
function drawVersion(m, version) {
  if (version < 7) return;
  const size = m.length;
  const bits = versionInfoBits(version);
  for (let i = 0; i < 18; i++) {
    const b = (bits >> i) & 1;
    m[Math.floor(i / 3)][size - 11 + (i % 3)] = b;
    m[size - 11 + (i % 3)][Math.floor(i / 3)] = b;
  }
}

function penalty(m) {
  const size = m.length;
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(m[i]);
    lines.push(m.map((row) => row[i]));
  }
  for (const line of lines) {
    // Rule 1: runs >= 5
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run += 1;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    // Rule 3: 1011101 with 4 light modules before or after
    const s = line.join("");
    for (let i = 0; i + 11 <= size; i++) {
      const w = s.slice(i, i + 11);
      if (w === "00001011101" || w === "10111010000") score += 40;
    }
  }
  // Rule 2: 2x2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }
  // Rule 4: dark ratio
  let dark = 0;
  for (const row of m) for (const v of row) if (v === 1) dark += 1;
  const total = size * size;
  const percent = (dark * 100) / total;
  const lower = Math.floor(percent / 5) * 5;
  const upper = lower + 5;
  score += (Math.min(Math.abs(lower - 50), Math.abs(upper - 50)) / 5) * 10;
  return score;
}

export function encodeQr(text) {
  const bytes = Array.from(Buffer.from(String(text), "utf8"));
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (bytes.length <= BYTE_CAPACITY_M[v]) { version = v; break; }
  }
  if (version === 0) throw new Error(`text too long: ${bytes.length} bytes (max 213 at EC level M, versions 1-10)`);
  const dataCodewords = buildDataCodewords(bytes, version);
  const all = interleave(dataCodewords, version);
  const bits = [];
  for (const b of all) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  for (let i = 0; i < REMAINDER_BITS[version]; i++) bits.push(0);

  // Track which cells are data cells: rebuild base and record empties.
  const base = baseMatrix(version);
  const dataCells = [];
  {
    const probe = base.map((row) => row.slice());
    const size = probe.length;
    let upward = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      for (let i = 0; i < size; i++) {
        const row = upward ? size - 1 - i : i;
        for (const c of [col, col - 1]) {
          if (probe[row][c] === null) dataCells.push([row, c]);
        }
      }
      upward = !upward;
    }
  }

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = base.map((row) => row.slice());
    dataCells.forEach(([r, c], idx) => {
      let v = idx < bits.length ? bits[idx] : 0;
      if (MASKS[mask](r, c)) v ^= 1;
      m[r][c] = v;
    });
    // Fill any still-null cells (shouldn't happen) with 0.
    for (const row of m) for (let i = 0; i < row.length; i++) if (row[i] === null) row[i] = 0;
    drawFormat(m, mask);
    drawVersion(m, version);
    const score = penalty(m);
    if (!best || score < best.score) best = { matrix: m, mask, score, version };
  }
  return best;
}

// ---- Rendering ----
export function toSvg(matrix, border = 4) {
  const size = matrix.length;
  const dim = size + border * 2;
  let path = "";
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) path += `M${c + border} ${r + border}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim * 8}" height="${dim * 8}"><rect width="${dim}" height="${dim}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
export function toPng(matrix, scale = 8, border = 4) {
  const size = matrix.length;
  const dim = (size + border * 2) * scale;
  const raw = Buffer.alloc(dim * (dim + 1));
  for (let y = 0; y < dim; y++) {
    const rowStart = y * (dim + 1);
    raw[rowStart] = 0; // filter: none
    const mr = Math.floor(y / scale) - border;
    for (let x = 0; x < dim; x++) {
      const mc = Math.floor(x / scale) - border;
      const dark = mr >= 0 && mr < size && mc >= 0 && mc < size && matrix[mr][mc] === 1;
      raw[rowStart + 1 + x] = dark ? 0 : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0);
  ihdr.writeUInt32BE(dim, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return { png, width: dim, height: dim };
}

function badRequest(message) {
  return { status: 400, json: { error: message } };
}
export const routes = [
  {
    id: "qr.generate",
    method: "POST",
    path: "/v1/qr",
    priceAtomic: "20000",
    priceUsd: 0.02,
    summary: "Generate a QR code (SVG or PNG) for arbitrary text/URLs, EC level M, up to 213 bytes",
    body: {
      required: ["text"],
      properties: {
        text: { type: "string", description: "Content to encode (UTF-8, max 213 bytes)", example: "https://example.com" },
        format: { type: "string", description: "\"svg\" (default, returned as image/svg+xml) or \"png\" (returned as base64 JSON)", example: "svg" },
        scale: { type: "integer", description: "PNG pixels per module, 1-20 (default 8)", example: 8 },
      },
    },
    handler({ body }) {
      if (!body || typeof body.text !== "string" || body.text.length === 0) {
        return badRequest("body.text (non-empty string) is required");
      }
      let encoded;
      try {
        encoded = encodeQr(body.text);
      } catch (e) {
        return badRequest(e.message);
      }
      const format = body.format || "svg";
      if (format === "svg") {
        return { status: 200, raw: toSvg(encoded.matrix), contentType: "image/svg+xml" };
      }
      if (format === "png") {
        const scale = Number.isInteger(body.scale) ? Math.min(20, Math.max(1, body.scale)) : 8;
        const { png, width, height } = toPng(encoded.matrix, scale);
        return { json: { format: "png", width, height, version: encoded.version, base64: png.toString("base64") } };
      }
      return badRequest("format must be \"svg\" or \"png\"");
    },
  },
];
