import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type KakitoriPlugin from "../main";

export class KakitoriSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: KakitoriPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Kakitori 设置" });

    new Setting(this.containerEl)
      .setName("新素材默认排版")
      .setDesc("每篇文章之后仍可单独切换横排或竖排。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("vertical", "竖排")
          .addOption("horizontal", "横排")
          .setValue(this.plugin.kakitoriSettings.defaultDirection)
          .onChange(async (value) => {
            this.plugin.kakitoriSettings.defaultDirection =
              value === "horizontal" ? "horizontal" : "vertical";
            await this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("悬浮时显示句子编号")
      .setDesc("默认关闭，让原稿纸保持干净。")
      .addToggle((toggle) =>
        toggle
          .setValue(
            this.plugin.kakitoriSettings.showSentenceNumbersOnHover
          )
          .onChange(async (value) => {
            this.plugin.kakitoriSettings.showSentenceNumbersOnHover = value;
            await this.plugin.saveSettings();
            await this.plugin.refreshViews();
          })
      );
  }
}
