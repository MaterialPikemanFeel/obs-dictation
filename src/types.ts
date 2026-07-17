export type WritingDirection = "vertical" | "horizontal";
export type CardDeckMode = "all" | "difficult" | "random";
export type LibrarySort = "practiced" | "created" | "name";

export interface KakitoriSettings {
  defaultDirection: WritingDirection;
  showSentenceNumbersOnHover: boolean;
  librarySort: LibrarySort;
  paperSizeScale: number;
  paperFontScale: number;
  azureRegion: string;
  azureVoice: string;
  azureSpeechKey: string;
}

export interface KakitoriTextHighlight {
  id: string;
  start: number;
  end: number;
}

export interface KakitoriSentence {
  id: string;
  text: string;
  startsParagraph: boolean;
  note: string;
  difficult: boolean;
  highlights: KakitoriTextHighlight[];
  recordedAt: string | null;
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
  lastPracticedAt: string | null;
  lastPaperPage: number;
  lastCardSentenceId: string | null;
}

export interface ImportedMaterial {
  title: string;
  sourceText: string;
}

export const DEFAULT_SETTINGS: KakitoriSettings = {
  defaultDirection: "vertical",
  showSentenceNumbersOnHover: false,
  librarySort: "practiced",
  paperSizeScale: 1,
  paperFontScale: 1,
  azureRegion: "eastus2",
  azureVoice: "ja-JP-NanamiNeural",
  azureSpeechKey: ""
};
