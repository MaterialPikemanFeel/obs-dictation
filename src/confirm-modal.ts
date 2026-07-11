import { Modal } from "obsidian";
import type { App } from "obsidian";

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly description: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: this.heading });
    this.contentEl.createEl("p", { text: this.description });
    const footer = this.contentEl.createDiv({
      cls: "kakitori-modal-footer"
    });
    const cancelButton = footer.createEl("button", { text: "取消" });
    const confirmButton = footer.createEl("button", {
      cls: "mod-warning",
      text: this.confirmLabel
    });
    cancelButton.addEventListener("click", () => this.close());
    confirmButton.addEventListener("click", () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
