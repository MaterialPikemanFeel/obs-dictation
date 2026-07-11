import { Modal } from "obsidian";
import type { App } from "obsidian";
import {
  countParagraphs,
  countWritingCharacters,
  deriveTitle,
  splitJapaneseSentences
} from "./segmenter";
import type { ImportedMaterial } from "./types";

export class ImportMaterialModal extends Modal {
  private title = "";
  private sourceText = "";
  private titleWasEdited = false;

  constructor(
    app: App,
    private readonly onImport: (material: ImportedMaterial) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("kakitori-import-modal");
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "导入听写素材" });
    this.contentEl.createEl("p", {
      cls: "kakitori-muted",
      text: "粘贴日语文本，或拖入 .txt / .md 文件。原文换行会保留为新段落。"
    });

    const dropZone = this.contentEl.createDiv({
      cls: "kakitori-import-drop-zone"
    });
    dropZone.createEl("span", { text: "拖入文本文件" });
    dropZone.createEl("small", { text: "或选择文件" });

    const fileInput = dropZone.createEl("input", {
      type: "file",
      attr: {
        accept: ".txt,.md,text/plain,text/markdown"
      }
    });

    const titleLabel = this.contentEl.createEl("label", {
      cls: "kakitori-field"
    });
    titleLabel.createEl("span", { text: "标题" });
    const titleInput = titleLabel.createEl("input", {
      type: "text",
      placeholder: "自动取第一行，也可以修改"
    });

    const textLabel = this.contentEl.createEl("label", {
      cls: "kakitori-field"
    });
    textLabel.createEl("span", { text: "原文" });
    const textArea = textLabel.createEl("textarea", {
      placeholder: "ここに日本語の文章を貼り付けます。"
    });
    textArea.rows = 12;

    const preview = this.contentEl.createDiv({
      cls: "kakitori-import-preview"
    });
    const previewStats = preview.createDiv();
    const previewSentences = preview.createDiv({
      cls: "kakitori-import-sentences"
    });

    const footer = this.contentEl.createDiv({
      cls: "kakitori-modal-footer"
    });
    const cancelButton = footer.createEl("button", { text: "取消" });
    const importButton = footer.createEl("button", {
      cls: "mod-cta",
      text: "导入素材"
    });
    importButton.disabled = true;

    const updatePreview = (): void => {
      const sentences = splitJapaneseSentences(this.sourceText);
      previewStats.setText(
        `${countWritingCharacters(this.sourceText)} 字 · ${sentences.length} 句 · ${countParagraphs(this.sourceText)} 段`
      );
      previewSentences.empty();
      for (const [index, sentence] of sentences.slice(0, 4).entries()) {
        previewSentences.createEl("div", {
          text: `${index + 1}. ${sentence}`
        });
      }
      if (sentences.length > 4) {
        previewSentences.createEl("div", {
          cls: "kakitori-muted",
          text: `还有 ${sentences.length - 4} 句…`
        });
      }
      importButton.disabled =
        !this.sourceText.trim() || !this.title.trim() || sentences.length === 0;
    };

    const setSourceText = (value: string): void => {
      this.sourceText = value;
      textArea.value = value;
      if (!this.titleWasEdited) {
        this.title = deriveTitle(value);
        titleInput.value = this.title;
      }
      updatePreview();
    };

    const readFile = async (file: File): Promise<void> => {
      if (!/\.(txt|md)$/i.test(file.name)) {
        return;
      }
      setSourceText(await file.text());
      if (!this.titleWasEdited) {
        this.title = file.name.replace(/\.(txt|md)$/i, "");
        titleInput.value = this.title;
      }
      updatePreview();
    };

    titleInput.addEventListener("input", () => {
      this.titleWasEdited = true;
      this.title = titleInput.value;
      updatePreview();
    });
    textArea.addEventListener("input", () => {
      setSourceText(textArea.value);
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.item(0);
      if (file) {
        void readFile(file);
      }
    });
    dropZone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropZone.addClass("is-dragging");
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.removeClass("is-dragging");
    });
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropZone.removeClass("is-dragging");
      const file = event.dataTransfer?.files.item(0);
      if (file) {
        void readFile(file);
      }
    });
    cancelButton.addEventListener("click", () => this.close());
    importButton.addEventListener("click", () => {
      if (importButton.disabled) {
        return;
      }
      importButton.disabled = true;
      void this.onImport({
        title: this.title.trim(),
        sourceText: this.sourceText
      }).then(() => this.close());
    });

    updatePreview();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
