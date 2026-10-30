import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAQ_PATH = path.resolve(__dirname, "../../../knowledge/pickup-faq.md");
const MAX_SECTIONS = 2;
const MAX_SECTION_CHARS = 400;

/** "## Heading\nbody" sections of knowledge/pickup-faq.md, re-read on
 * every call so policy edits apply without a restart (the file is tiny). */
function loadSections() {
  let raw = "";
  try {
    raw = fs.readFileSync(FAQ_PATH, "utf8");
  } catch {
    return [];
  }
  return raw
    .split(/\n(?=## )/)
    .map((c) => c.trim())
    .filter((c) => c.startsWith("## "));
}

/** Keyword-overlap lookup — the FAQ has ~8 sections, so this is enough
 * and keeps the answer grounded in our own text (no LLM in this path). */
export function answerPickupPolicy(question) {
  const sections = loadSections();
  if (!sections.length) {
    return "Maaf kijiye, abhi yeh jaankari uplabdh nahi hai. Kripya ShipGoods app dekhiye.";
  }

  const terms = String(question || "")
    .toLowerCase()
    .split(/[^a-z0-9ऀ-ॿ]+/)
    .filter((t) => t.length > 2);

  const ranked = sections
    .map((section) => {
      const lower = section.toLowerCase();
      const score = terms.reduce((sum, t) => sum + (lower.includes(t) ? 1 : 0), 0);
      return { section, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SECTIONS)
    .map((x) => x.section);

  const picked = ranked.length ? ranked : sections.slice(0, MAX_SECTIONS);
  return picked
    .map((section) =>
      section
        .replace(/^##\s+[^\n]*\n?/, "") // heading is for us, not the caller
        .trim()
        .slice(0, MAX_SECTION_CHARS)
    )
    .join("\n");
}
