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

    this.containerEl.createEl("h3", { text: "Azure 语音" });

    new Setting(this.containerEl)
      .setName("Azure 区域")
      .setDesc("填写语音资源所在区域，例如 eastasia 或 japaneast。")
      .addText((text) =>
        text
          .setPlaceholder("eastasia")
          .setValue(this.plugin.kakitoriSettings.azureRegion)
          .onChange(async (value) => {
            this.plugin.kakitoriSettings.azureRegion = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(this.containerEl)
      .setName("日语音色")
      .setDesc("生成新音频时使用；已缓存的句子不会重复请求。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ja-JP-NanamiNeural", "Nanami（女声）")
          .addOption("ja-JP-KeitaNeural", "Keita（男声）")
          .setValue(this.plugin.kakitoriSettings.azureVoice)
          .onChange(async (value) => {
            this.plugin.kakitoriSettings.azureVoice = value;
            await this.plugin.saveSettings();
          })
      );

    const existingKey = this.plugin.getAzureSpeechKey();
    const hasSecureStorage = this.plugin.hasSecureSecretStorage();
    new Setting(this.containerEl)
      .setName("Azure Speech 密钥")
      .setDesc(
        hasSecureStorage
          ? existingKey
            ? "密钥已安全保存在 Obsidian；输入新密钥可替换。"
            : "密钥只保存在 Obsidian 的安全存储中，不写入 Vault。"
          : "当前 Obsidian 不支持安全存储；密钥仅在本次启动期间有效。"
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(existingKey ? "已保存" : "粘贴密钥");
        text.onChange((value) => {
          const key = value.trim();
          if (key) {
            this.plugin.setAzureSpeechKey(key);
          }
        });
      })
      .addButton((button) =>
        button.setButtonText("清除密钥").onClick(() => {
          this.plugin.clearAzureSpeechKey();
          this.display();
        })
      );
  }
}
