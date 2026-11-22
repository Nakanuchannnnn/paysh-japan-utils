#!/usr/bin/env python3
"""Build data/fx.json from the ECB daily euro reference rates XML.
Source: https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
(rates are daily reference rates, EUR base; free, no key, no registration.)
Output: {"as_of": "2026-11-20", "base": "EUR", "rates": {"USD": 1.099, ...}}
"""
import json
import re
import sys

XML_PATH = sys.argv[1] if len(sys.argv) > 1 else "eurofxref-daily.xml"
OUT_PATH = sys.argv[2] if len(sys.argv) > 2 else "data/fx.json"

text = open(XML_PATH, encoding="utf-8").read()
date_m = re.search(r"<Cube time='(\d{4}-\d{2}-\d{2})'>", text)
rates = {"EUR": 1.0}
for cur, rate in re.findall(r"<Cube currency='([A-Z]{3})' rate='([\d.]+)'/>", text):
    rates[cur] = float(rate)
out = {
    "as_of": date_m.group(1) if date_m else None,
    "base": "EUR",
    "source": "European Central Bank daily reference rates",
    "rates": rates,
}
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"as_of={out['as_of']} currencies={len(rates)}")
