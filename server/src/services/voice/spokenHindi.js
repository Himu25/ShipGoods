// Ready-to-speak Hindi for the pickup call, so the voice agent reads a
// natural phrase instead of improvising ("D, L, ek, C, ek, do..." or
// "ek kilometre teen sau meter" both sounded robotic on calls).

const NUMBERS_HI = [
  "शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ",
  "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
  "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस",
  "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
  "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास",
  "पचास", "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
  "साठ", "इकसठ", "बासठ", "तिरसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर",
  "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी",
  "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सत्तासी", "अट्ठासी", "नवासी",
  "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पंचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे",
];

const LETTERS_HI = {
  A: "ए", B: "बी", C: "सी", D: "डी", E: "ई", F: "एफ", G: "जी", H: "एच", I: "आई",
  J: "जे", K: "के", L: "एल", M: "एम", N: "एन", O: "ओ", P: "पी", Q: "क्यू", R: "आर",
  S: "एस", T: "टी", U: "यू", V: "वी", W: "डब्ल्यू", X: "एक्स", Y: "वाई", Z: "ज़ेड",
};

/** 0-99 in Hindi words; larger numbers fall back to digits. */
export function hindiNumber(n) {
  return Number.isInteger(n) && n >= 0 && n < 100 ? NUMBERS_HI[n] : String(n);
}

const digitByDigit = (digits) => digits.split("").map((d) => NUMBERS_HI[Number(d)]).join(" ");
const letters = (s) => s.split("").map((ch) => LETTERS_HI[ch] || ch).join(" ");

/** The number part the way people say it: "1234" -> "बारह चौंतीस",
 * but "0001" or "1204" digit by digit so nothing is lost. */
function spokenDigits(digits) {
  if (digits.length === 4 && digits[0] !== "0" && digits[2] !== "0") {
    return `${hindiNumber(Number(digits.slice(0, 2)))} ${hindiNumber(Number(digits.slice(2)))}`;
  }
  if (digits.length <= 2 && digits[0] !== "0") return hindiNumber(Number(digits));
  return digitByDigit(digits);
}

/**
 * Indian number plate as spoken: "DL1C1234" -> "डी एल एक सी, बारह चौंतीस",
 * "UP16MD0001" -> "यू पी सोलह एम डी, शून्य शून्य शून्य एक". Anything that
 * isn't a standard plate is read character by character.
 */
export function spokenPlate(plate) {
  const clean = String(plate || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!clean) return "";
  const m = clean.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  if (!m) {
    return clean.split("").map((ch) => (/\d/.test(ch) ? NUMBERS_HI[Number(ch)] : LETTERS_HI[ch] || ch)).join(" ");
  }
  const [, state, district, series, number] = m;
  const head = [letters(state), hindiNumber(Number(district)), series && letters(series)].filter(Boolean).join(" ");
  return `${head}, ${spokenDigits(number)}`;
}

/** "लगभग अठारह किलोमीटर प्रति घंटा"; null when it can't be known. */
export function spokenSpeed(kmph) {
  if (!Number.isFinite(kmph) || kmph <= 0) return null;
  return `लगभग ${hindiNumber(Math.max(1, Math.round(kmph)))} किलोमीटर प्रति घंटा`;
}

/**
 * Distance as people say it, rounded: "सौ मीटर से कम", "आठ सौ मीटर",
 * "सवा किलोमीटर", "डेढ़ किलोमीटर", "पौने तीन किलोमीटर", "चार किलोमीटर".
 */
export function spokenDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return null;
  if (meters < 150) return "सौ मीटर से भी कम";
  if (meters < 950) return `${hindiNumber(Math.round(meters / 100))} सौ मीटर`;

  const quarters = Math.round(meters / 250);
  const whole = Math.floor(quarters / 4);
  const rest = quarters % 4;
  if (rest === 0) return `${hindiNumber(whole)} किलोमीटर`;
  if (rest === 1) return whole === 1 ? "सवा किलोमीटर" : `सवा ${hindiNumber(whole)} किलोमीटर`;
  if (rest === 2) {
    if (whole === 1) return "डेढ़ किलोमीटर";
    if (whole === 2) return "ढाई किलोमीटर";
    return `साढ़े ${hindiNumber(whole)} किलोमीटर`;
  }
  return `पौने ${hindiNumber(whole + 1)} किलोमीटर`;
}
