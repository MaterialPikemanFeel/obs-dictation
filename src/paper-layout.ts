import type {
  KakitoriSentence,
  WritingDirection
} from "./types";

const CELLS_PER_LINE = 20;
const CELLS_PER_PAGE = CELLS_PER_LINE * CELLS_PER_LINE;

interface CharacterToken {
  character: string;
  sentenceId: string;
  sentenceCharacterIndex: number;
  sentenceCharacterCount: number;
}

type PaperCell = CharacterToken | null;

export interface PlacedCharacter extends CharacterToken {
  column: number;
  row: number;
}

export interface MaskSegment {
  sentenceId: string;
  leftPercent: number;
  topPercent: number;
  widthPercent: number;
  heightPercent: number;
  isSentenceStart: boolean;
  isSentenceEnd: boolean;
}

export interface PaperPageLayout {
  characters: PlacedCharacter[];
  masks: MaskSegment[];
  pageCount: number;
  continuesFromPrevious: boolean;
  continuesOnNext: boolean;
}

export function getPaperPageCount(sentences: KakitoriSentence[]): number {
  return Math.max(
    1,
    Math.ceil(buildPaperCells(sentences).length / CELLS_PER_PAGE)
  );
}

export function buildPaperPageLayout(
  sentences: KakitoriSentence[],
  pageIndex: number,
  direction: WritingDirection
): PaperPageLayout {
  const cells = buildPaperCells(sentences);
  const pageCount = Math.max(1, Math.ceil(cells.length / CELLS_PER_PAGE));
  const safePageIndex = Math.min(Math.max(pageIndex, 0), pageCount - 1);
  const pageStart = safePageIndex * CELLS_PER_PAGE;
  const pageEnd = (safePageIndex + 1) * CELLS_PER_PAGE;
  const pageCells = cells.slice(pageStart, pageEnd);
  const characters = pageCells.flatMap((token, index) => {
    if (!token) {
      return [];
    }
    const line = Math.floor(index / CELLS_PER_LINE);
    const offset = index % CELLS_PER_LINE;
    return [
      direction === "vertical"
        ? {
            ...token,
            column: CELLS_PER_LINE - 1 - line,
            row: offset
          }
        : {
            ...token,
            column: offset,
            row: line
          }
    ];
  });

  return {
    characters,
    masks: buildMaskSegments(characters, direction),
    pageCount,
    continuesFromPrevious:
      pageStart > 0 &&
      cells[pageStart - 1]?.sentenceId === cells[pageStart]?.sentenceId,
    continuesOnNext:
      pageEnd < cells.length &&
      cells[pageEnd - 1]?.sentenceId === cells[pageEnd]?.sentenceId
  };
}

function buildPaperCells(sentences: KakitoriSentence[]): PaperCell[] {
  const cells: PaperCell[] = [];

  for (const sentence of sentences) {
    if (sentence.startsParagraph) {
      while (cells.length % CELLS_PER_LINE !== 0) {
        cells.push(null);
      }
      cells.push(null);
    }

    const characters = Array.from(sentence.text);
    for (const [sentenceCharacterIndex, character] of characters.entries()) {
      cells.push({
        character,
        sentenceId: sentence.id,
        sentenceCharacterIndex,
        sentenceCharacterCount: characters.length
      });
    }
  }

  return cells;
}

function buildMaskSegments(
  characters: PlacedCharacter[],
  direction: WritingDirection
): MaskSegment[] {
  const groups = new Map<string, PlacedCharacter[]>();

  for (const character of characters) {
    const line =
      direction === "vertical" ? character.column : character.row;
    const key = `${character.sentenceId}:${line}`;
    const group = groups.get(key) ?? [];
    group.push(character);
    groups.set(key, group);
  }

  return Array.from(groups.values()).map((group) => {
    const first = group[0];
    if (!first) {
      throw new Error("Mask group cannot be empty.");
    }

    if (direction === "vertical") {
      const rows = group.map((character) => character.row);
      const firstRow = Math.min(...rows);
      const lastRow = Math.max(...rows);
      return {
        sentenceId: first.sentenceId,
        leftPercent: first.column * 5,
        topPercent: firstRow * 5,
        widthPercent: 5,
        heightPercent: (lastRow - firstRow + 1) * 5,
        isSentenceStart: group.some(
          (character) => character.sentenceCharacterIndex === 0
        ),
        isSentenceEnd: group.some(
          (character) =>
            character.sentenceCharacterIndex ===
            character.sentenceCharacterCount - 1
        )
      };
    }

    const columns = group.map((character) => character.column);
    const firstColumn = Math.min(...columns);
    const lastColumn = Math.max(...columns);
    return {
      sentenceId: first.sentenceId,
      leftPercent: firstColumn * 5,
      topPercent: first.row * 5,
      widthPercent: (lastColumn - firstColumn + 1) * 5,
      heightPercent: 5,
      isSentenceStart: group.some(
        (character) => character.sentenceCharacterIndex === 0
      ),
      isSentenceEnd: group.some(
        (character) =>
          character.sentenceCharacterIndex ===
          character.sentenceCharacterCount - 1
      )
    };
  });
}
