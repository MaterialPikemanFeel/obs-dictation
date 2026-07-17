import { Notice, PluginSettingTab, Setting } from "obsidian";
import type {
  App,
  ButtonComponent,
  DropdownComponent
} from "obsidian";
import type KakitoriPlugin from "../main";
import type { AzureVoiceOption } from "./tts";

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

const FALLBACK_JAPANESE_VOICES = [
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

    new Setting(this.containerEl)
      .setName("原稿纸大小")
      .setDesc("调整整张 20×20 原稿纸的显示尺寸（格子数量不变），范围 70%～160%。")
      .addSlider((slider) =>
        slider
          .setLimits(0.7, 1.6, 0.05)
          .setValue(this.plugin.kakitoriSettings.paperSizeScale)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.kakitoriSettings.paperSizeScale = value;
            await this.plugin.saveSettings();
            await this.plugin.refreshViews();
          })
      );

    new Setting(this.containerEl)
      .setName("原稿纸文字大小")
      .setDesc("调整格子内文字的字号，范围 70%～160%。")
      .addSlider((slider) =>
        slider
          .setLimits(0.7, 1.6, 0.05)
          .setValue(this.plugin.kakitoriSettings.paperFontScale)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.kakitoriSettings.paperFontScale = value;
            await this.plugin.saveSettings();
            await this.plugin.refreshViews();
          })
      );

    this.containerEl.createEl("h3", { text: "音频缓存" });

    new Setting(this.containerEl)
      .setName("缓存上限")
      .setDesc("超出上限时自动删除最久未播放的音频，范围 20～1000 MB。")
      .addSlider((slider) =>
        slider
          .setLimits(20, 1000, 20)
          .setValue(this.plugin.kakitoriSettings.audioCacheLimitMb)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.kakitoriSettings.audioCacheLimitMb = value;
            await this.plugin.saveSettings();
            await this.plugin.tts.enforceCacheLimit();
          })
      );

    const usageSetting = new Setting(this.containerEl)
      .setName("当前缓存")
      .setDesc("计算中…");
    const refreshUsage = async (): Promise<void> => {
      try {
        const usage = await this.plugin.tts.getCacheUsage();
        usageSetting.setDesc(
          usage.files === 0
            ? "缓存为空。"
            : `${usage.files} 个音频文件，共 ${formatBytes(usage.bytes)}。`
        );
      } catch {
        usageSetting.setDesc("无法读取缓存目录。");
      }
    };
    usageSetting.addButton((button) =>
      button.setButtonText("清空缓存").onClick(async () => {
        button.setDisabled(true);
        try {
          const removed = await this.plugin.tts.clearCache();
          new Notice(`已删除 ${removed} 个缓存音频。`);
        } catch {
          new Notice("清空缓存失败。");
        } finally {
          button.setDisabled(false);
          await refreshUsage();
        }
      })
    );
    void refreshUsage();

    this.containerEl.createEl("h3", { text: "Azure 语音" });

    const existingKey = this.plugin.getAzureSpeechKey();
    const hasSecureStorage = this.plugin.hasSecureSecretStorage();
    let keyInput: HTMLInputElement | null = null;
    let voiceDropdown: DropdownComponent | null = null;
    let refreshVoiceButton: ButtonComponent | null = null;
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
      .setDesc("从 Azure 实时查询 ja-JP 音色，包括可用的 HD／Latest 模型。")
      .addDropdown((dropdown) => {
        for (const [value, label] of FALLBACK_JAPANESE_VOICES) {
          dropdown.addOption(value, label);
        }
        if (
          !FALLBACK_JAPANESE_VOICES.some(
            ([value]) =>
              value === this.plugin.kakitoriSettings.azureVoice
          )
        ) {
          dropdown.addOption(
            this.plugin.kakitoriSettings.azureVoice,
            this.plugin.kakitoriSettings.azureVoice
          );
        }
        dropdown
          .setValue(this.plugin.kakitoriSettings.azureVoice)
          .onChange(async (value) => {
            this.plugin.kakitoriSettings.azureVoice = value;
            await this.plugin.saveSettings();
          });
        voiceDropdown = dropdown;
      })
      .addButton((button) => {
        refreshVoiceButton = button;
        button.setButtonText("查询音色").onClick(async () => {
          if (voiceDropdown) {
            await this.refreshJapaneseVoices(
              voiceDropdown,
              button,
              true
            );
          }
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

    if (existingKey && voiceDropdown && refreshVoiceButton) {
      void this.refreshJapaneseVoices(
        voiceDropdown,
        refreshVoiceButton,
        false
      );
    }
  }

  private async refreshJapaneseVoices(
    dropdown: DropdownComponent,
    button: ButtonComponent,
    showResult: boolean
  ): Promise<void> {
    const subscriptionKey = this.plugin.getAzureSpeechKey();
    if (!subscriptionKey) {
      if (showResult) {
        new Notice("请先填写 API Key。");
      }
      return;
    }

    const originalText = button.buttonEl.textContent ?? "查询音色";
    button.setDisabled(true).setButtonText("查询中…");
    try {
      const voices = await this.plugin.tts.listJapaneseVoices(
        this.plugin.kakitoriSettings.azureRegion,
        subscriptionKey
      );
      if (voices.length === 0) {
        throw new Error("No Japanese voices returned");
      }
      dropdown.selectEl.replaceChildren();
      for (const voice of voices) {
        dropdown.addOption(
          voice.shortName,
          this.formatVoiceLabel(voice)
        );
      }
      const selectedVoice = voices.some(
        (voice) =>
          voice.shortName === this.plugin.kakitoriSettings.azureVoice
      )
        ? this.plugin.kakitoriSettings.azureVoice
        : voices[0].shortName;
      dropdown.setValue(selectedVoice);
      if (selectedVoice !== this.plugin.kakitoriSettings.azureVoice) {
        this.plugin.kakitoriSettings.azureVoice = selectedVoice;
        await this.plugin.saveSettings();
      }
      if (showResult) {
        new Notice(`已获取 ${voices.length} 个日语音色。`);
      }
    } catch {
      if (showResult) {
        new Notice("查询失败，请检查 API Key 和区域是否匹配。");
      }
    } finally {
      button.setDisabled(false).setButtonText(originalText);
    }
  }

  private formatVoiceLabel(voice: AzureVoiceOption): string {
    const gender =
      voice.gender.toLowerCase() === "female"
        ? "女声"
        : voice.gender.toLowerCase() === "male"
          ? "男声"
          : voice.gender;
    const model = getVoiceModelLabel(voice);
    const name = model ? `${voice.displayName} ${model}` : voice.displayName;
    const status =
      voice.status && voice.status.toLowerCase() !== "ga"
        ? ` · ${voice.status}`
        : "";
    return `${name} · ${gender} · ${voice.locale}${status}`;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getVoiceModelLabel(voice: AzureVoiceOption): string {
  const model = voice.shortName.split(":")[1] ?? "";
  if (!model) {
    return "";
  }
  const readable = model
    .replace(/Neural$/u, "")
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/HD/gu, " HD")
    .replace(/\s+/gu, " ")
    .trim();
  return voice.displayName.toLowerCase().includes(readable.toLowerCase())
    ? ""
    : readable;
}
