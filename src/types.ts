export type WritingDirection = "vertical" | "horizontal";

export interface KakitoriSettings {
  defaultDirection: WritingDirection;
  showSentenceNumbersOnHover: boolean;
}

export interface KakitoriSentence {
  id: string;
  text: string;
  startsParagraph: boolean;
  note: string;
  difficult: boolean;
}

export interface KakitoriMaterial {
  id: string;
  title: string;
  sourceText: string;
  direction: WritingDirection;
  sentences: KakitoriSentence[];
  fullNote: string;
  createdAt: string;
  updatedAt: string;
  lastPaperPage: number;
}

export interface ImportedMaterial {
  title: string;
  sourceText: string;
}

export const DEFAULT_SETTINGS: KakitoriSettings = {
  defaultDirection: "vertical",
  showSentenceNumbersOnHover: false
};
