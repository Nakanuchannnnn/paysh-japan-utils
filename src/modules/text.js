// Text utilities: kana<->romaji (Hepburn), Unicode slugify, width normalization.
// All deterministic, no external data.

const KANA_ROMAJI = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "wo", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
  ゐ: "wi", ゑ: "we", ゔ: "vu",
};
const YOON = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
};
function kataToHira(s) {
  return s.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
export function kanaToRomaji(input) {
  const s = kataToHira(String(input));
  let out = "";
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    const ch = s[i];
    if (YOON[two]) {
      out += YOON[two];
      i += 2;
      continue;
    }
    if (ch === "っ") {
      const nextTwo = s.slice(i + 1, i + 3);
      const next = YOON[nextTwo] || KANA_ROMAJI[s[i + 1]] || "";
      if (next) {
        if (next.startsWith("ch")) out += "t";
        else if (!"aiueo".includes(next[0])) out += next[0];
      }
      i += 1;
      continue;
    }
    if (ch === "ー") {
      const prev = out.slice(-1);
      if ("aiueo".includes(prev)) out += prev === "o" ? "u" : prev;
      i += 1;
      continue;
    }
    if (ch === "ん") {
      const next = s[i + 1];
      const nextRomaji = next ? KANA_ROMAJI[next] || "" : "";
      // Modified Hepburn: m before b/p/m sounds.
      out += /^[bmp]/.test(nextRomaji) ? "m" : "n";
      i += 1;
      continue;
    }
    if (KANA_ROMAJI[ch]) {
      // Hepburn long vowels: お+う -> ou, え+い -> ei are kept literal here
      // (ou/ei), which matches common passport-style rendering.
      out += KANA_ROMAJI[ch];
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const ROMAJI_KANA = {};
for (const [k, v] of Object.entries(KANA_ROMAJI)) {
  if (!(v in ROMAJI_KANA) && k !== "ぢ" && k !== "づ") ROMAJI_KANA[v] = k;
}
for (const [k, v] of Object.entries(YOON)) ROMAJI_KANA[v] = k;
ROMAJI_KANA["si"] = "し"; ROMAJI_KANA["ti"] = "ち"; ROMAJI_KANA["tu"] = "つ";
ROMAJI_KANA["hu"] = "ふ"; ROMAJI_KANA["zi"] = "じ"; ROMAJI_KANA["di"] = "ぢ"; ROMAJI_KANA["du"] = "づ";
ROMAJI_KANA["sya"] = "しゃ"; ROMAJI_KANA["syu"] = "しゅ"; ROMAJI_KANA["syo"] = "しょ";
ROMAJI_KANA["tya"] = "ちゃ"; ROMAJI_KANA["tyu"] = "ちゅ"; ROMAJI_KANA["tyo"] = "ちょ";
ROMAJI_KANA["jya"] = "じゃ"; ROMAJI_KANA["jyu"] = "じゅ"; ROMAJI_KANA["jyo"] = "じょ";
ROMAJI_KANA["nn"] = "ん"; ROMAJI_KANA["m"] = "ん";
export function romajiToKana(input) {
  const s = String(input).toLowerCase();
  let out = "";
  let i = 0;
  const syllables = Object.keys(ROMAJI_KANA).sort((a, b) => b.length - a.length);
  while (i < s.length) {
    const rest = s.slice(i);
    // Sokuon: doubled consonant (except n) -> っ
    if (/^([bcdfghjklmpqrstvwxyz])\1/.test(rest) && rest[0] !== "n") {
      out += "っ";
      i += 1;
      continue;
    }
    if (rest.startsWith("tch")) {
      out += "っ";
      i += 1;
      continue;
    }
    let matched = null;
    for (const syl of syllables) {
      if (rest.startsWith(syl)) { matched = syl; break; }
    }
    if (matched) {
      out += ROMAJI_KANA[matched];
      i += matched.length;
      continue;
    }
    if (rest[0] === "n" && (i + 1 >= s.length || !"aiueoy".includes(s[i + 1]))) {
      out += "ん";
      i += 1;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

export function slugify(text, unicode) {
  let s = String(text);
  if (!unicode) {
    s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    // Convert kana to romaji so Japanese titles produce meaningful ASCII slugs.
    s = kanaToRomaji(s);
    s = s.replace(/[^a-zA-Z0-9]+/g, "-");
  } else {
    s = s.replace(/[^\p{L}\p{N}]+/gu, "-");
  }
  return s.replace(/^-+|-+$/g, "").toLowerCase();
}

function toHalfwidth(s) {
  return s.normalize("NFKC");
}
function toFullwidth(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const code = ch.charCodeAt(0);
    if (code === 0x20) { out += "　"; i += 1; continue; }
    if (code >= 0x21 && code <= 0x7e) {
      out += String.fromCharCode(code + 0xfee0);
      i += 1;
      continue;
    }
    if (code >= 0xff61 && code <= 0xff9f) {
      // Run of halfwidth kana -> NFKC (handles dakuten pairs correctly).
      let j = i;
      while (j < s.length && s.charCodeAt(j) >= 0xff61 && s.charCodeAt(j) <= 0xff9f) j += 1;
      out += s.slice(i, j).normalize("NFKC");
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function badRequest(message) {
  return { status: 400, json: { error: message } };
}
function textBody(body, maxLen = 10000) {
  if (!body || typeof body.text !== "string") return null;
  if (body.text.length > maxLen) return null;
  return body.text;
}

export const routes = [
  {
    id: "text.romaji",
    method: "POST",
    path: "/v1/text/romaji",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Convert Japanese kana to Hepburn romaji, or romaji to hiragana",
    body: {
      required: ["text"],
      properties: {
        text: { type: "string", description: "Kana text (to-romaji) or romaji text (to-kana)", example: "とうきょう" },
        direction: { type: "string", description: "\"to-romaji\" (default) or \"to-kana\"", example: "to-romaji" },
      },
    },
    handler({ body }) {
      const text = textBody(body);
      if (text === null) return badRequest("body.text (string, <=10000 chars) is required");
      const direction = body.direction || "to-romaji";
      if (direction === "to-romaji") return { json: { result: kanaToRomaji(text), direction } };
      if (direction === "to-kana") return { json: { result: romajiToKana(text), direction } };
      return badRequest("direction must be \"to-romaji\" or \"to-kana\"");
    },
  },
  {
    id: "text.slug",
    method: "POST",
    path: "/v1/text/slug",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Slugify arbitrary Unicode text (Japanese kana become romaji in ASCII mode)",
    body: {
      required: ["text"],
      properties: {
        text: { type: "string", description: "Text to slugify", example: "東京スカイツリーの写真！" },
        unicode: { type: "boolean", description: "Keep non-ASCII letters instead of transliterating (default false)", example: false },
      },
    },
    handler({ body }) {
      const text = textBody(body);
      if (text === null) return badRequest("body.text (string, <=10000 chars) is required");
      return { json: { slug: slugify(text, body.unicode === true) } };
    },
  },
  {
    id: "text.normalize",
    method: "POST",
    path: "/v1/text/normalize",
    priceAtomic: "10000",
    priceUsd: 0.01,
    summary: "Normalize Japanese text width: fullwidth <-> halfwidth (NFKC-based)",
    body: {
      required: ["text", "mode"],
      properties: {
        text: { type: "string", description: "Text to normalize", example: "ＡＢＣ１２３ｶﾀｶﾅ" },
        mode: { type: "string", description: "\"halfwidth\", \"fullwidth\", or \"nfkc\"", example: "halfwidth" },
      },
    },
    handler({ body }) {
      const text = textBody(body);
      if (text === null) return badRequest("body.text (string, <=10000 chars) is required");
      if (body.mode === "halfwidth" || body.mode === "nfkc") return { json: { result: toHalfwidth(text), mode: body.mode } };
      if (body.mode === "fullwidth") return { json: { result: toFullwidth(text), mode: body.mode } };
      return badRequest("mode must be \"halfwidth\", \"fullwidth\", or \"nfkc\"");
    },
  },
];
