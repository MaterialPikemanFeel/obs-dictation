const TERMINATORS = new Set(["。", "！", "？", "!", "?"]);
const OPENING_MARKS = new Set(["「", "『", "（", "(", "［", "[", "【"]);
const CLOSING_MARKS = new Set(["」", "』", "）", ")", "］", "]", "】"]);

export interface SegmentedSentence {
  text: string;
  startsParagraph: boolean;
}

export function normalizeWritingText(sourceText: string): string {
  return sourceText.replace(/\s+/g, "");
}

export function segmentJapaneseText(
  sourceText: string
): SegmentedSentence[] {
  const paragraphs = sourceText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return paragraphs.flatMap((paragraph) =>
    splitParagraph(paragraph).map((text, index) => ({
      text,
      startsParagraph: index === 0
    }))
  );
}

export function splitJapaneseSentences(sourceText: string): string[] {
  return segmentJapaneseText(sourceText).map((sentence) => sentence.text);
}

export function countParagraphs(sourceText: string): number {
  return sourceText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((paragraph) => paragraph.trim().length > 0).length;
}

function splitParagraph(text: string): string[] {
  const sentences: string[] = [];
  let buffer = "";
  let nestingDepth = 0;
  let pendingTerminator = false;

  const flush = (): void => {
    const sentence = normalizeWritingText(buffer);
    if (sentence) {
      sentences.push(sentence);
    }
    buffer = "";
    pendingTerminator = false;
  };

  const characters = Array.from(text);
  for (const [index, character] of characters.entries()) {
    buffer += character;

    if (OPENING_MARKS.has(character)) {
      nestingDepth += 1;
      continue;
    }

    if (CLOSING_MARKS.has(character)) {
      nestingDepth = Math.max(0, nestingDepth - 1);
      const nextCharacter = characters[index + 1];
      if (
        pendingTerminator &&
        nestingDepth === 0 &&
        (!nextCharacter ||
          (!CLOSING_MARKS.has(nextCharacter) &&
            !TERMINATORS.has(nextCharacter)))
      ) {
        flush();
      }
      continue;
    }

    if (TERMINATORS.has(character)) {
      pendingTerminator = true;
      const nextCharacter = characters[index + 1];
      if (
        nestingDepth === 0 &&
        (!nextCharacter ||
          (!TERMINATORS.has(nextCharacter) &&
            !CLOSING_MARKS.has(nextCharacter)))
      ) {
        flush();
      }
    }
  }

  if (buffer.trim()) {
    flush();
  }

  return sentences;
}

export function deriveTitle(sourceText: string): string {
  const firstLine = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "未命名素材";
  }

  const cleaned = firstLine.replace(/^#+\s*/, "");
  return Array.from(cleaned).slice(0, 28).join("") || "未命名素材";
}

export function countWritingCharacters(sourceText: string): number {
  return Array.from(normalizeWritingText(sourceText)).length;
}
