import { normalizePath, requestUrl } from "obsidian";
import type { App } from "obsidian";

export const AZURE_SPEECH_KEY_ID = "kakitori-azure-speech-key";

const CACHE_DIRECTORY = "_Kakitori/Cache";

export interface AzureSpeechConfig {
  region: string;
  voice: string;
  subscriptionKey: string;
}

export class AzureTtsService {
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private playRequestId = 0;

  constructor(private readonly app: App) {}

  async prepare(text: string, config: AzureSpeechConfig): Promise<void> {
    await this.getAudio(text, config);
  }

  async play(
    text: string,
    config: AzureSpeechConfig,
    playbackRate: number
  ): Promise<void> {
    const requestId = ++this.playRequestId;
    this.stopAudio();
    const audioData = await this.getAudio(text, config);
    if (requestId !== this.playRequestId) {
      return;
    }

    const audioUrl = URL.createObjectURL(
      new Blob([audioData], { type: "audio/mpeg" })
    );
    const audio = new Audio(audioUrl);
    audio.playbackRate = playbackRate;
    this.currentAudio = audio;
    this.currentAudioUrl = audioUrl;
    const release = (): void => {
      if (this.currentAudio === audio) {
        this.currentAudio = null;
        this.releaseAudioUrl();
      }
    };
    audio.addEventListener("ended", release, { once: true });
    audio.addEventListener("error", release, { once: true });
    try {
      await audio.play();
    } catch (error) {
      release();
      throw error;
    }
  }

  stop(): void {
    this.playRequestId += 1;
    this.stopAudio();
  }

  private stopAudio(): void {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    this.releaseAudioUrl();
  }

  private async getAudio(
    text: string,
    config: AzureSpeechConfig
  ): Promise<ArrayBuffer> {
    const cachePath = normalizePath(
      `${CACHE_DIRECTORY}/${await this.getCacheKey(text, config)}.mp3`
    );
    if (await this.app.vault.adapter.exists(cachePath)) {
      return this.app.vault.adapter.readBinary(cachePath);
    }

    const audioData = await this.synthesize(text, config);
    await this.app.vault.adapter.writeBinary(cachePath, audioData);
    return audioData;
  }

  private async synthesize(
    text: string,
    config: AzureSpeechConfig
  ): Promise<ArrayBuffer> {
    if (!/^[a-z0-9-]+$/i.test(config.region)) {
      throw new Error("Azure region is invalid");
    }
    const response = await requestUrl({
      url: `https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      method: "POST",
      contentType: "application/ssml+xml",
      headers: {
        "Ocp-Apim-Subscription-Key": config.subscriptionKey,
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "Kakitori"
      },
      body: [
        '<speak version="1.0" xml:lang="ja-JP">',
        `<voice xml:lang="ja-JP" name="${escapeXml(config.voice)}">`,
        escapeXml(text),
        "</voice>",
        "</speak>"
      ].join(""),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Azure TTS request failed (${response.status})`);
    }
    return response.arrayBuffer;
  }

  private async getCacheKey(
    text: string,
    config: AzureSpeechConfig
  ): Promise<string> {
    const input = new TextEncoder().encode(
      `${config.region}\u0000${config.voice}\u0000${text}`
    );
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  private releaseAudioUrl(): void {
    if (this.currentAudioUrl) {
      URL.revokeObjectURL(this.currentAudioUrl);
      this.currentAudioUrl = null;
    }
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
