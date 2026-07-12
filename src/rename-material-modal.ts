import { Modal } from "obsidian";
import type { App } from "obsidian";

export class RenameMaterialModal extends Modal {
  constructor(
    app: App,
    private readonly currentTitle: string,
    private readonly onRename: (title: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h2", { text: "重命名素材" });
    const input = this.contentEl.createEl("input", {
      type: "text",
      value: this.currentTitle,
      attr: {
        "aria-label": "素材名称",
        placeholder: "输入素材名称"
      }
    });
    input.addClass("kakitori-rename-input");

    const footer = this.contentEl.createDiv({
      cls: "kakitori-modal-footer"
    });
    const cancelButton = footer.createEl("button", { text: "取消" });
    const saveButton = footer.createEl("button", {
      cls: "mod-cta",
      text: "保存"
    });

    const save = (): void => {
      const title = input.value.trim();
      if (!title) {
        input.focus();
        return;
      }
      void this.onRename(title).then(() => this.close());
    };

    cancelButton.addEventListener("click", () => this.close());
    saveButton.addEventListener("click", save);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        save();
      }
    });

    window.setTimeout(() => {
      input.focus();
      input.select();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
