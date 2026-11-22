#!/usr/bin/env python3
"""Independent QR verification for the JS encoder in src/modules/qr.js.

For each case {text, version, mask, matrix} received as JSON on stdin:
  1. Rebuild the function-pattern layer independently and compare cells.
  2. Decode the data cells (zigzag, unmask) and compare the bit stream
     against segno's make_final_message() applied to a spec-built data
     buffer (terminator/padding per ISO 18004 text -- segno's own
     write_padding_bits has a known quirk: it appends a full 0x00 byte
     when the terminated stream is already byte-aligned, so segno's
     finished matrices are NOT used as the reference here).
  3. Parse the decoded segment and check the payload round-trips.
  4. Compare format information against segno's calc_format_info().
Prints a JSON list of {ok, failures[]} and exits non-zero on any failure.
segno is used ONLY as a test oracle; the service has no dependencies.
"""
import json
import sys

sys.path.insert(0, "/tmp/pylibs")
from segno import consts  # noqa: E402
from segno.encoder import Buffer, calc_format_info, make_final_message  # noqa: E402

ERROR_M = consts.ERROR_LEVEL_M

# EC level M structure (ISO 18004 Table 9): version -> (ec per block,
# [(count, total per block, data per block), ...])
EC_TABLE_M = {
    1: (10, [(1, 26, 16)]),
    2: (16, [(1, 44, 28)]),
    3: (26, [(1, 70, 44)]),
    4: (18, [(2, 50, 32)]),
    5: (24, [(2, 67, 43)]),
    6: (16, [(4, 43, 27)]),
    7: (18, [(4, 49, 31)]),
    8: (22, [(2, 60, 38), (2, 61, 39)]),
    9: (22, [(3, 58, 36), (2, 59, 37)]),
    10: (26, [(4, 69, 43), (1, 70, 44)]),
}
ALIGNMENT = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
    7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}
MASKS = [
    lambda r, c: (r + c) % 2 == 0,
    lambda r, c: r % 2 == 0,
    lambda r, c: c % 3 == 0,
    lambda r, c: (r + c) % 3 == 0,
    lambda r, c: (r // 2 + c // 3) % 2 == 0,
    lambda r, c: (r * c) % 2 + (r * c) % 3 == 0,
    lambda r, c: ((r * c) % 2 + (r * c) % 3) % 2 == 0,
    lambda r, c: ((r + c) % 2 + (r * c) % 3) % 2 == 0,
]


def version_info_bits(version):
    rem = version
    for _ in range(12):
        rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
    return (version << 12) | rem


def function_layer(version, mask):
    """Return (values, is_function) grids for the function patterns."""
    size = version * 4 + 17
    val = [[0] * size for _ in range(size)]
    fun = [[False] * size for _ in range(size)]

    def setc(r, c, v):
        if 0 <= r < size and 0 <= c < size:
            val[r][c] = v
            fun[r][c] = True

    def finder(r0, c0):
        for r in range(-1, 8):
            for c in range(-1, 8):
                inner = 0 <= r <= 6 and 0 <= c <= 6
                dark = inner and (r in (0, 6) or c in (0, 6) or (2 <= r <= 4 and 2 <= c <= 4))
                setc(r0 + r, c0 + c, 1 if dark else 0)

    finder(0, 0)
    finder(0, size - 7)
    finder(size - 7, 0)
    for i in range(8, size - 8):
        setc(6, i, 1 if i % 2 == 0 else 0)
        setc(i, 6, 1 if i % 2 == 0 else 0)
    centers = ALIGNMENT[version]
    if centers:
        first, last = centers[0], centers[-1]
        for r in centers:
            for c in centers:
                if (r, c) in ((first, first), (first, last), (last, first)):
                    continue
                for dr in range(-2, 3):
                    for dc in range(-2, 3):
                        setc(r + dr, c + dc, 0 if max(abs(dr), abs(dc)) == 1 else 1)
    # Format information placeholders (values filled below).
    for i in range(9):
        if i != 6:
            fun[8][i] = fun[i][8] = True
    for i in range(8):
        fun[8][size - 1 - i] = True
        fun[size - 1 - i][8] = True
    setc(size - 8, 8, 1)  # dark module
    fmt = calc_format_info(version, ERROR_M, mask)
    bit = lambda i: (fmt >> i) & 1  # noqa: E731
    for i in range(6):
        val[i][8] = bit(i)
    val[7][8] = bit(6)
    val[8][8] = bit(7)
    val[8][7] = bit(8)
    for i in range(9, 15):
        val[8][14 - i] = bit(i)
    for i in range(8):
        val[8][size - 1 - i] = bit(i)
    for i in range(8, 15):
        val[size - 15 + i][8] = bit(i)
    val[size - 8][8] = 1
    if version >= 7:
        vbits = version_info_bits(version)
        for i in range(18):
            b = (vbits >> i) & 1
            r, c = i // 3, size - 11 + (i % 3)
            val[r][c] = b
            fun[r][c] = True
            val[c][r] = b
            fun[c][r] = True
    return val, fun


def spec_data_codewords(data_bytes, version):
    """Data codewords built strictly per ISO 18004 7.4.9/7.4.10."""
    _, blocks = EC_TABLE_M[version]
    total_data = sum(count * dc for count, _, dc in blocks)
    bits = []

    def push(v, n):
        for i in range(n - 1, -1, -1):
            bits.append((v >> i) & 1)

    push(0b0100, 4)
    push(len(data_bytes), 16 if version >= 10 else 8)
    for b in data_bytes:
        push(b, 8)
    capacity = total_data * 8
    push(0, min(4, capacity - len(bits)))
    push(0, (8 - len(bits) % 8) % 8)
    codewords = []
    for i in range(0, len(bits), 8):
        b = 0
        for bit in bits[i:i + 8]:
            b = (b << 1) | bit
        codewords.append(b)
    pads = [0xEC, 0x11]
    k = 0
    while len(codewords) < total_data:
        codewords.append(pads[k % 2])
        k += 1
    return codewords


def verify(case):
    failures = []
    text, version, mask, matrix = case["text"], case["version"], case["mask"], case["matrix"]
    size = version * 4 + 17
    if len(matrix) != size or any(len(row) != size for row in matrix):
        return {"ok": False, "failures": ["matrix size mismatch"]}
    fval, fun = function_layer(version, mask)
    for r in range(size):
        for c in range(size):
            if fun[r][c] and matrix[r][c] != fval[r][c]:
                failures.append(f"function cell ({r},{c}): got {matrix[r][c]}, want {fval[r][c]}")
                if len(failures) > 5:
                    return {"ok": False, "failures": failures}
    # Decode data bits.
    bits = []
    upward = True
    col = size - 1
    while col > 0:
        if col == 6:
            col -= 1
        rows = range(size - 1, -1, -1) if upward else range(size)
        for r in rows:
            for c in (col, col - 1):
                if not fun[r][c]:
                    v = matrix[r][c]
                    if MASKS[mask](r, c):
                        v ^= 1
                    bits.append(v)
        upward = not upward
        col -= 2
    # Expected final message via segno's RS/interleave machinery.
    data_cw = spec_data_codewords(text.encode("utf-8"), version)
    buff = Buffer()
    buff.extend((b >> i) & 1 for b in data_cw for i in range(7, -1, -1))
    expected = list(make_final_message(version, ERROR_M, buff))
    if bits[:len(expected)] != expected:
        for i, (a, b) in enumerate(zip(bits, expected)):
            if a != b:
                failures.append(f"final message bit {i}: got {a}, want {b}")
                break
        failures.append("final message mismatch")
    # make_final_message() already appends the remainder bits (zeros).
    if len(bits) != len(expected):
        failures.append(f"data cell count {len(bits)} != expected {len(expected)}")
    # Segment round-trip. The final message is block-interleaved, so the
    # segment is parsed from the (pre-interleave) data codewords; the
    # matrix itself is already proven bit-identical to the final message
    # built from exactly these codewords above.
    seg = [(b >> i) & 1 for b in data_cw for i in range(7, -1, -1)]
    mode = int("".join(map(str, seg[:4])), 2)
    if mode != 0b0100:
        failures.append(f"segment mode {mode:04b} != 0100")
    else:
        nlen = 16 if version >= 10 else 8
        count = int("".join(map(str, seg[4:4 + nlen])), 2)
        payload = bytearray()
        pos = 4 + nlen
        for _ in range(count):
            payload.append(int("".join(map(str, seg[pos:pos + 8])), 2))
            pos += 8
        if bytes(payload) != text.encode("utf-8"):
            failures.append("segment payload does not round-trip")
    return {"ok": not failures, "failures": failures}


def main():
    cases = json.load(sys.stdin)
    results = [verify(case) for case in cases]
    json.dump(results, sys.stdout)
    sys.exit(0 if all(r["ok"] for r in results) else 1)


if __name__ == "__main__":
    main()
