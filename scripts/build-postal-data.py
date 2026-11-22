#!/usr/bin/env python3
"""Build data/postal.json from Japan Post KEN_ALL.CSV (Shift_JIS / CP932).

Source: https://www.post.japanpost.jp/service/search/zipcode/download/kogaki/zip/ken_all.zip
KEN_ALL.CSV columns (no header):
  0 JIS municipality code, 1 old 5-digit zip, 2 zip (7 digits),
  3 prefecture kana, 4 city kana, 5 town kana,
  6 prefecture, 7 city, 8 town,
  9-14 flags / update markers.
Long town names are split across consecutive rows; a continuation row is
detected when the previous row's town name has an unclosed '（' (the standard
heuristic for this dataset) with identical zip/prefecture/city.
Output: { "1000001": [[prefecture, city, town, pref_kana, city_kana, town_kana], ...], ... }
"""
import csv
import io
import json
import sys
import unicodedata
import zipfile

ZIP_PATH = sys.argv[1] if len(sys.argv) > 1 else "ken_all.zip"
OUT_PATH = sys.argv[2] if len(sys.argv) > 2 else "data/postal.json"


def fw(s: str) -> str:
    """Halfwidth kana -> fullwidth (kana fields only)."""
    return unicodedata.normalize("NFKC", s)


def unclosed(s: str) -> bool:
    return s.count("（") > s.count("）")


def main() -> None:
    with zipfile.ZipFile(ZIP_PATH) as z:
        name = [n for n in z.namelist() if n.upper().endswith(".CSV")][0]
        raw = z.read(name)
    text = raw.decode("cp932")
    rows = list(csv.reader(io.StringIO(text)))

    data: dict[str, list[list[str]]] = {}
    prev_key = None  # (zip, prefecture, city)
    prev_entry = None
    merged = 0
    for r in rows:
        if len(r) < 9:
            continue
        zip7 = r[2].strip()
        pk, ck, tk = fw(r[3].strip()), fw(r[4].strip()), fw(r[5].strip())
        p, c, t = r[6].strip(), r[7].strip(), r[8].strip()
        if t == "以下に掲載がない場合":
            t = ""
            tk = ""
        key = (zip7, p, c)
        if (
            prev_entry is not None
            and key == prev_key
            and (unclosed(prev_entry[2]) or unclosed(prev_entry[5]))
        ):
            prev_entry[2] += t
            prev_entry[5] += tk
            merged += 1
            continue
        entry = [p, c, t, pk, ck, tk]
        data.setdefault(zip7, []).append(entry)
        prev_key = key
        prev_entry = entry

    # Deduplicate identical entries per zip (dataset contains exact dup rows).
    for z, entries in data.items():
        seen = set()
        uniq = []
        for e in entries:
            k = tuple(e)
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        data[z] = uniq

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"rows={len(rows)} merged_continuations={merged} unique_zips={len(data)}")


if __name__ == "__main__":
    main()
