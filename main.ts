import { Notice, Plugin } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { KakitoriSettingTab } from "./src/settings-tab";
import { KakitoriStorage } from "./src/storage";
import type {
  ImportedMaterial,
  KakitoriMaterial,
  KakitoriSettings
} from "./src/types";
import { KakitoriView, VIEW_TYPE_KAKITORI } from "./src/view";

export default class KakitoriPlugin extends Plugin {
  storage!: KakitoriStorage;
  kakitoriSettings!: KakitoriSettings;

  async onload(): Promise<void> {
    this.storage = new KakitoriStorage(this.app);
    await this.storage.initialize();
    this.kakitoriSettings = await this.storage.loadSettings();

    this.registerView(
      VIEW_TYPE_KAKITORI,
      (leaf) => new KakitoriView(leaf, this)
    );

    this.addRibbonIcon("notebook-tabs", "打开 Kakitori", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-kakitori",
      name: "打开 Kakitori",
      callback: () => {
        void this.activateView();
      }
    });
    this.addSettingTab(new KakitoriSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_KAKITORI);
  }

  async activateView(): Promise<void> {
    const existingLeaf = this.app.workspace.getLeavesOfType(
      VIEW_TYPE_KAKITORI
    )[0];
    const leaf = existingLeaf ?? this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: VIEW_TYPE_KAKITORI,
      active: true
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  async importMaterial(imported: ImportedMaterial): Promise<KakitoriMaterial> {
    const material = await this.storage.createMaterial(
      imported,
      this.kakitoriSettings.defaultDirection
    );
    new Notice(`已导入「${material.title}」`);
    return material;
  }

  async saveMaterial(material: KakitoriMaterial): Promise<void> {
    await this.storage.saveMaterial(material);
  }

  async saveSettings(): Promise<void> {
    await this.storage.saveSettings(this.kakitoriSettings);
  }

  async refreshViews(): Promise<void> {
    await Promise.all(
      this.app.workspace
        .getLeavesOfType(VIEW_TYPE_KAKITORI)
        .map(async (leaf: WorkspaceLeaf) => {
          if (leaf.view instanceof KakitoriView) {
            await leaf.view.refresh();
          }
        })
    );
  }
}
