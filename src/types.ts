export type WritingDirection = "vertical" | "horizontal";
export type CardDeckMode = "all" | "difficult" | "random";

export interface KakitoriSettings {
  defaultDirection: WritingDirection;
  showSentenceNumbersOnHover: boolean;
  azureRegion: string;
  azureVoice: string;
  azureSpeechKey: string;
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
  lastCardSentenceId: string | null;
}

export interface ImportedMaterial {
  title: string;
  sourceText: string;
}

export const DEFAULT_SETTINGS: KakitoriSettings = {
  defaultDirection: "vertical",
  showSentenceNumbersOnHover: false,
  azureRegion: "eastus2",
  azureVoice: "ja-JP-NanamiNeural",
  azureSpeechKey: ""
};
