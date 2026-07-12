import { normalizePath } from "obsidian";
import type { App } from "obsidian";
import { segmentJapaneseText } from "./segmenter";
import {
  DEFAULT_SETTINGS,
  type ImportedMaterial,
  type KakitoriMaterial,
  type KakitoriSettings,
  type KakitoriSentence,
  type KakitoriTextHighlight,
  type WritingDirection
} from "./types";

const ROOT = "_Kakitori";
const MATERIALS_DIRECTORY = `${ROOT}/Materials`;
const NOTEBOOKS_DIRECTORY = `${ROOT}/Notebooks`;
const CACHE_DIRECTORY = `${ROOT}/Cache`;
const SETTINGS_PATH = `${ROOT}/settings.json`;

interface MaterialFile {
  version: 1;
  id: string;
  title: string;
  sourceText: string;
  direction: WritingDirection;
  sentenceIds: string[];
  createdAt: string;
  updatedAt: string;
  lastPracticedAt?: string | null;
  lastPaperPage: number;
  lastCardSentenceId?: string | null;
}

interface SentenceNotebookEntry {
  note: string;
  difficult: boolean;
  highlights?: KakitoriTextHighlight[];
  recordedAt?: string | null;
}

interface NotebookFile {
  version: 1;
  materialId: string;
  fullNote: string;
  sentences: Record<string, SentenceNotebookEntry>;
}

export class KakitoriStorage {
  constructor(private readonly app: App) {}

  async initialize(): Promise<void> {
    for (const folder of [
      ROOT,
      MATERIALS_DIRECTORY,
      NOTEBOOKS_DIRECTORY,
      CACHE_DIRECTORY
    ]) {
      await this.ensureFolder(folder);
    }

    if (!(await this.app.vault.adapter.exists(normalizePath(SETTINGS_PATH)))) {
      await this.saveSettings(DEFAULT_SETTINGS);
    }
  }

  async loadSettings(): Promise<KakitoriSettings> {
    try {
      const raw = await this.app.vault.adapter.read(normalizePath(SETTINGS_PATH));
      const parsed = JSON.parse(raw) as Partial<KakitoriSettings>;
      return {
        defaultDirection:
          parsed.defaultDirection === "horizontal" ? "horizontal" : "vertical",
        showSentenceNumbersOnHover:
          parsed.showSentenceNumbersOnHover === true,
        librarySort:
          parsed.librarySort === "created" ||
          parsed.librarySort === "name"
            ? parsed.librarySort
            : "practiced",
        azureRegion:
          parsed.azureRegion?.trim() || DEFAULT_SETTINGS.azureRegion,
        azureVoice:
          parsed.azureVoice?.trim() || DEFAULT_SETTINGS.azureVoice,
        azureSpeechKey: parsed.azureSpeechKey?.trim() ?? ""
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(settings: KakitoriSettings): Promise<void> {
    await this.app.vault.adapter.write(
      normalizePath(SETTINGS_PATH),
      JSON.stringify(settings, null, 2)
    );
  }

  async listMaterials(): Promise<KakitoriMaterial[]> {
    const listing = await this.app.vault.adapter.list(
      normalizePath(MATERIALS_DIRECTORY)
    );
    const materials = await Promise.all(
      listing.files
        .filter((path) => path.endsWith(".json"))
        .map(async (path) => this.readMaterialFile(path))
    );

    return materials
      .filter((material): material is KakitoriMaterial => material !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getMaterial(id: string): Promise<KakitoriMaterial | null> {
    return this.readMaterialFile(this.materialPath(id));
  }

  async createMaterial(
    imported: ImportedMaterial,
    defaultDirection: WritingDirection
  ): Promise<KakitoriMaterial> {
    const now = new Date().toISOString();
    const material: KakitoriMaterial = {
      id: crypto.randomUUID(),
      title: imported.title.trim() || "未命名素材",
      sourceText: imported.sourceText,
      direction: defaultDirection,
      sentences: segmentJapaneseText(imported.sourceText).map((sentence) => ({
        id: crypto.randomUUID(),
        text: sentence.text,
        startsParagraph: sentence.startsParagraph,
        note: "",
        difficult: false,
        highlights: [],
        recordedAt: null
      })),
      fullNote: "",
      createdAt: now,
      updatedAt: now,
      lastPracticedAt: null,
      lastPaperPage: 0,
      lastCardSentenceId: null
    };
    await this.saveMaterial(material);
    return material;
  }

  async saveMaterial(material: KakitoriMaterial): Promise<void> {
    material.updatedAt = new Date().toISOString();

    const materialFile: MaterialFile = {
      version: 1,
      id: material.id,
      title: material.title,
      sourceText: material.sourceText,
      direction: material.direction,
      sentenceIds: material.sentences.map((sentence) => sentence.id),
      createdAt: material.createdAt,
      updatedAt: material.updatedAt,
      lastPracticedAt: material.lastPracticedAt,
      lastPaperPage: material.lastPaperPage,
      lastCardSentenceId: material.lastCardSentenceId
    };
    const notebookFile: NotebookFile = {
      version: 1,
      materialId: material.id,
      fullNote: material.fullNote,
      sentences: Object.fromEntries(
        material.sentences.map((sentence) => [
          sentence.id,
          {
            note: sentence.note,
            difficult: sentence.difficult,
            highlights: sentence.highlights,
            recordedAt: sentence.recordedAt
          }
        ])
      )
    };

    await Promise.all([
      this.app.vault.adapter.write(
        normalizePath(this.materialPath(material.id)),
        JSON.stringify(materialFile, null, 2)
      ),
      this.app.vault.adapter.write(
        normalizePath(this.notebookPath(material.id)),
        JSON.stringify(notebookFile, null, 2)
      )
    ]);
  }

  async deleteMaterial(materialId: string): Promise<void> {
    await Promise.all(
      [this.materialPath(materialId), this.notebookPath(materialId)].map(
        async (path) => {
          const normalized = normalizePath(path);
          if (await this.app.vault.adapter.exists(normalized)) {
            await this.app.vault.adapter.remove(normalized);
          }
        }
      )
    );
  }

  private async readMaterialFile(path: string): Promise<KakitoriMaterial | null> {
    try {
      const raw = await this.app.vault.adapter.read(normalizePath(path));
      const materialFile = JSON.parse(raw) as MaterialFile;
      const notebook = await this.readNotebook(materialFile.id);
      const segmentedSentences = segmentJapaneseText(materialFile.sourceText);
      const sentences: KakitoriSentence[] = segmentedSentences.map(
        (segmentedSentence, index) => {
        const id = materialFile.sentenceIds[index] ?? crypto.randomUUID();
        const notebookEntry = notebook.sentences[id];
        return {
          id,
          text: segmentedSentence.text,
          startsParagraph: segmentedSentence.startsParagraph,
          note: notebookEntry?.note ?? "",
          difficult: notebookEntry?.difficult ?? false,
          highlights: normalizeHighlights(
            notebookEntry?.highlights,
            segmentedSentence.text
          ),
          recordedAt:
            typeof notebookEntry?.recordedAt === "string"
              ? notebookEntry.recordedAt
              : null
        };
        }
      );

      return {
        id: materialFile.id,
        title: materialFile.title,
        sourceText: materialFile.sourceText,
        direction:
          materialFile.direction === "horizontal" ? "horizontal" : "vertical",
        sentences,
        fullNote: notebook.fullNote,
        createdAt: materialFile.createdAt,
        updatedAt: materialFile.updatedAt,
        lastPracticedAt:
          typeof materialFile.lastPracticedAt === "string"
            ? materialFile.lastPracticedAt
            : materialFile.lastPaperPage > 0 ||
                Boolean(materialFile.lastCardSentenceId)
              ? materialFile.updatedAt
              : null,
        lastPaperPage: Math.max(0, materialFile.lastPaperPage),
        lastCardSentenceId:
          materialFile.lastCardSentenceId &&
          sentences.some(
            (sentence) => sentence.id === materialFile.lastCardSentenceId
          )
            ? materialFile.lastCardSentenceId
            : null
      };
    } catch {
      return null;
    }
  }

  private async readNotebook(materialId: string): Promise<NotebookFile> {
    const path = normalizePath(this.notebookPath(materialId));
    try {
      const raw = await this.app.vault.adapter.read(path);
      return JSON.parse(raw) as NotebookFile;
    } catch {
      return {
        version: 1,
        materialId,
        fullNote: "",
        sentences: {}
      };
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!(await this.app.vault.adapter.exists(normalized))) {
      await this.app.vault.createFolder(normalized);
    }
  }

  private materialPath(id: string): string {
    return `${MATERIALS_DIRECTORY}/${id}.json`;
  }

  private notebookPath(id: string): string {
    return `${NOTEBOOKS_DIRECTORY}/${id}.json`;
  }
}

function normalizeHighlights(
  highlights: KakitoriTextHighlight[] | undefined,
  text: string
): KakitoriTextHighlight[] {
  if (!Array.isArray(highlights)) {
    return [];
  }
  const characterCount = Array.from(text).length;
  return highlights.filter(
    (highlight) =>
      typeof highlight?.id === "string" &&
      Number.isInteger(highlight.start) &&
      Number.isInteger(highlight.end) &&
      highlight.start >= 0 &&
      highlight.end > highlight.start &&
      highlight.end <= characterCount
  );
}
