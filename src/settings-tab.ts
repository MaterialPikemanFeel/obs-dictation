import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type KakitoriPlugin from "../main";

const AZURE_REGIONS = [
  ["eastus", "East US"],
  ["eastus2", "East US 2"],
  ["westus", "West US"],
  ["westus2", "West US 2"],
  ["westus3", "West US 3"],
  ["centralus", "Central US"],
  ["northcentralus", "North Central US"],
  ["southcentralus", "South Central US"],
  ["canadacentral", "Canada Central"],
  ["brazilsouth", "Brazil South"],
  ["eastasia", "East Asia (Hong Kong)"],
  ["southeastasia", "Southeast Asia (Singapore)"],
  ["japaneast", "Japan East (Tokyo)"],
  ["japanwest", "Japan West (Osaka)"],
  ["koreacentral", "Korea Central (Seoul)"],
  ["centralindia", "Central India"],
  ["australiaeast", "Australia East"],
  ["westeurope", "West Europe"],
  ["northeurope", "North Europe"],
  ["uksouth", "UK South"],
  ["francecentral", "France Central"],
  ["germanywestcentral", "Germany West Central"],
  ["swedencentral", "Sweden Central"],
  ["switzerlandnorth", "Switzerland North"],
  ["uaenorth", "UAE North"],
  ["southafricanorth", "South Africa North"]
] as const;

const JAPANESE_VOICES = [
  ["ja-JP-NanamiNeural", "Nanami（女声）"],
  ["ja-JP-AoiNeural", "Aoi（女声）"],
  ["ja-JP-MayuNeural", "Mayu（女声）"],
  ["ja-JP-ShioriNeural", "Shiori（女声）"],
  ["ja-JP-KeitaNeural", "Keita（男声）"],
  ["ja-JP-DaichiNeural", "Daichi（男声）"],
  ["ja-JP-NaokiNeural", "Naoki（男声）"]
] as const;

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

    const existingKey = this.plugin.getAzureSpeechKey();
    const hasSecureStorage = this.plugin.hasSecureSecretStorage();
    let keyInput: HTMLInputElement | null = null;
    new Setting(this.containerEl)
      .setName("API Key")
      .setDesc(
        hasSecureStorage
          ? "密钥保存在 Obsidian 的安全存储中。"
          : "密钥保存在 Kakitori 设置中，重启后仍可使用。"
      )
      .addText((text) => {
        keyInput = text.inputEl;
        text.inputEl.type = "password";
        text
          .setPlaceholder("粘贴 Azure Speech API Key")
          .setValue(existingKey ?? "")
          .onChange(async (value) => {
            await this.plugin.setAzureSpeechKey(value);
          });
      })
      .addButton((button) =>
        button.setButtonText("显示").onClick(() => {
          if (!keyInput) {
            return;
          }
          const showKey = keyInput.type === "password";
          keyInput.type = showKey ? "text" : "password";
          button.setButtonText(showKey ? "隐藏" : "显示");
        })
      )
      .addButton((button) =>
        button.setButtonText("清除").onClick(async () => {
          await this.plugin.clearAzureSpeechKey();
          this.display();
        })
      );

    new Setting(this.containerEl)
      .setName("区域")
      .setDesc("选择 Azure Speech 资源页面显示的 Region，无需手动填写代码。")
      .addDropdown((dropdown) => {
        for (const [value, label] of AZURE_REGIONS) {
          dropdown.addOption(value, `${label}（${value}）`);
        }
        dropdown
          .setValue(this.plugin.kakitoriSettings.azureRegion)
          .onChange(async (value) => {
            this.plugin.kakitoriSettings.azureRegion = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(this.containerEl)
      .setName("日语音色")
      .setDesc("生成新音频时使用；已缓存的句子不会重复请求。")
      .addDropdown((dropdown) => {
        for (const [value, label] of JAPANESE_VOICES) {
          dropdown.addOption(value, label);
        }
        dropdown
          .setValue(this.plugin.kakitoriSettings.azureVoice)
          .onChange(async (value) => {
            this.plugin.kakitoriSettings.azureVoice = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(this.containerEl)
      .setName("测试语音")
      .setDesc("播放一句日语，确认 API Key、区域和音色设置正确。")
      .addButton((button) =>
        button
          .setButtonText("播放测试语音")
          .setCta()
          .onClick(async () => {
            const subscriptionKey = this.plugin.getAzureSpeechKey();
            if (!subscriptionKey) {
              new Notice("请先填写 API Key。");
              return;
            }
            button.setDisabled(true);
            try {
              await this.plugin.tts.play(
                "これは音声テストです。",
                {
                  region: this.plugin.kakitoriSettings.azureRegion,
                  voice: this.plugin.kakitoriSettings.azureVoice,
                  subscriptionKey
                },
                1
              );
              new Notice("测试语音已播放。");
            } catch {
              new Notice("播放失败，请检查 API Key 和区域是否匹配。");
            } finally {
              button.setDisabled(false);
            }
          })
      );
  }
}
