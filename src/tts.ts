import { normalizePath, requestUrl } from "obsidian";
import type { App } from "obsidian";

export const AZURE_SPEECH_KEY_ID = "kakitori-azure-speech-key";

const CACHE_DIRECTORY = "_Kakitori/Cache";

export interface AzureSpeechConfig {
  region: string;
  voice: string;
  subscriptionKey: string;
}

export interface AzureVoiceOption {
  shortName: string;
  displayName: string;
  localName: string;
  gender: string;
  locale: string;
  voiceType: string;
  status: string;
  styles: string[];
}

interface CacheEntry {
  path: string;
  size: number;
  mtime: number;
}

export interface CacheUsage {
  files: number;
  bytes: number;
}

export class AzureTtsService {
  private currentAudio: HTMLAudioElement | null = null;
  private currentAudioUrl: string | null = null;
  private playRequestId = 0;

  constructor(
    private readonly app: App,
    private readonly getCacheLimitBytes: () => number
  ) {}

  async prepare(text: string, config: AzureSpeechConfig): Promise<void> {
    await this.getAudio(text, config);
  }

  async listJapaneseVoices(
    region: string,
    subscriptionKey: string
  ): Promise<AzureVoiceOption[]> {
    this.validateRegion(region);
    const response = await requestUrl({
      url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
      method: "GET",
      headers: {
        "Ocp-Apim-Subscription-Key": subscriptionKey
      },
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Azure voice list request failed (${response.status})`);
    }
    const payload: unknown = response.json;
    if (!Array.isArray(payload)) {
      throw new Error("Azure voice list response is invalid");
    }
    return payload
      .map(parseAzureVoice)
      .filter(
        (voice): voice is AzureVoiceOption =>
          voice !== null && voice.locale.toLowerCase() === "ja-jp"
      )
      .sort((left, right) => {
        const modelPriority =
          Number(right.shortName.includes(":DragonHD")) -
          Number(left.shortName.includes(":DragonHD"));
        return (
          modelPriority ||
          left.displayName.localeCompare(right.displayName, "en")
        );
      });
  }

  async play(
    text: string,
    config: AzureSpeechConfig,
    playbackRate: number,
    forceRegenerate = false
  ): Promise<void> {
    const requestId = ++this.playRequestId;
    this.stopAudio();
    const audioData = await this.getAudio(
      text,
      config,
      forceRegenerate
    );
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

  async getCacheUsage(): Promise<CacheUsage> {
    const entries = await this.listCacheEntries();
    return {
      files: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.size, 0)
    };
  }

  async clearCache(): Promise<number> {
    const entries = await this.listCacheEntries();
    await Promise.all(
      entries.map(async (entry) => this.app.vault.adapter.remove(entry.path))
    );
    return entries.length;
  }

  async removeCachedAudio(
    texts: string[],
    region: string,
    voice: string
  ): Promise<void> {
    await Promise.all(
      texts.map(async (text) => {
        const cachePath = await this.getCachePath(text, {
          region,
          voice,
          subscriptionKey: ""
        });
        if (await this.app.vault.adapter.exists(cachePath)) {
          await this.app.vault.adapter.remove(cachePath);
        }
      })
    );
  }

  async enforceCacheLimit(): Promise<void> {
    const limit = this.getCacheLimitBytes();
    if (!Number.isFinite(limit) || limit <= 0) {
      return;
    }
    const entries = await this.listCacheEntries();
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= limit) {
      return;
    }
    entries.sort((left, right) => left.mtime - right.mtime);
    for (const entry of entries) {
      if (total <= limit) {
        break;
      }
      await this.app.vault.adapter.remove(entry.path);
      total -= entry.size;
    }
  }

  private async listCacheEntries(): Promise<CacheEntry[]> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(CACHE_DIRECTORY))) {
      return [];
    }
    const listing = await adapter.list(CACHE_DIRECTORY);
    const entries: CacheEntry[] = [];
    for (const path of listing.files) {
      if (!path.endsWith(".mp3")) {
        continue;
      }
      const stat = await adapter.stat(path);
      if (stat) {
        entries.push({ path, size: stat.size, mtime: stat.mtime });
      }
    }
    return entries;
  }

  private async getCachePath(
    text: string,
    config: AzureSpeechConfig
  ): Promise<string> {
    return normalizePath(
      `${CACHE_DIRECTORY}/${await this.getCacheKey(text, config)}.mp3`
    );
  }

  private async getAudio(
    text: string,
    config: AzureSpeechConfig,
    forceRegenerate = false
  ): Promise<ArrayBuffer> {
    const cachePath = await this.getCachePath(text, config);
    if (
      !forceRegenerate &&
      (await this.app.vault.adapter.exists(cachePath))
    ) {
      const audioData = await this.app.vault.adapter.readBinary(cachePath);
      // Rewrite on hit so mtime tracks recency for eviction.
      void this.app.vault.adapter.writeBinary(cachePath, audioData);
      return audioData;
    }

    const audioData = await this.synthesize(text, config);
    await this.app.vault.adapter.writeBinary(cachePath, audioData);
    void this.enforceCacheLimit();
    return audioData;
  }

  private async synthesize(
    text: string,
    config: AzureSpeechConfig
  ): Promise<ArrayBuffer> {
    this.validateRegion(config.region);
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

  private validateRegion(region: string): void {
    if (!/^[a-z0-9-]+$/i.test(region)) {
      throw new Error("Azure region is invalid");
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

function parseAzureVoice(value: unknown): AzureVoiceOption | null {
  if (!isRecord(value)) {
    return null;
  }
  const shortName = readString(value, "ShortName") || readString(value, "Name");
  const locale = readString(value, "Locale");
  if (!shortName || !locale) {
    return null;
  }
  const displayName =
    readString(value, "DisplayName") ||
    readString(value, "LocalName") ||
    shortName;
  return {
    shortName,
    displayName,
    localName: readString(value, "LocalName") || displayName,
    gender: readString(value, "Gender") || "Unknown",
    locale,
    voiceType: readString(value, "VoiceType") || "Neural",
    status: readString(value, "Status"),
    styles: readStringArray(value, "StyleList")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  value: Record<string, unknown>,
  key: string
): string {
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : "";
}

function readStringArray(
  value: Record<string, unknown>,
  key: string
): string[] {
  const candidate = value[key];
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string")
    : [];
}
