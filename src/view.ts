import {
  ItemView,
  Notice,
  setIcon
} from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type KakitoriPlugin from "../main";
import { ConfirmModal } from "./confirm-modal";
import { ImportMaterialModal } from "./import-modal";
import {
  buildPaperPageLayout,
  getPaperPageCount,
  type PaperPageLayout
} from "./paper-layout";
import {
  countParagraphs,
  countWritingCharacters
} from "./segmenter";
import type { AzureSpeechConfig } from "./tts";
import type {
  CardDeckMode,
  KakitoriMaterial,
  WritingDirection
} from "./types";

export const VIEW_TYPE_KAKITORI = "kakitori-view";

type KakitoriScreen = "library" | "home" | "paper" | "card";
type NotesTab = "sentence" | "vocabulary" | "article";

export class KakitoriView extends ItemView {
  private materials: KakitoriMaterial[] = [];
  private activeMaterial: KakitoriMaterial | null = null;
  private screen: KakitoriScreen = "library";
  private currentPage = 0;
  private cardDeckMode: CardDeckMode = "all";
  private cardSequenceIds: string[] = [];
  private currentCardIndex = 0;
  private cardRevealed = false;
  private readonly revealedSentenceIds = new Set<string>();
  private selectedSentenceId: string | null = null;
  private pinnedSentenceId: string | null = null;
  private notesTab: NotesTab = "sentence";
  private notesCollapsed = false;
  private playbackSpeed = 1;
  private floatingControlsEl: HTMLElement | null = null;
  private paperEl: HTMLElement | null = null;
  private notesPanelEl: HTMLElement | null = null;
  private hideControlsTimer: number | null = null;
  private saveTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: KakitoriPlugin
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_KAKITORI;
  }

  getDisplayText(): string {
    return "Kakitori";
  }

  getIcon(): string {
    return "notebook-tabs";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("kakitori-view-content");
    this.contentEl.tabIndex = 0;
    this.registerDomEvent(this.contentEl, "keydown", (event) => {
      this.handleKeyboard(event);
    });
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.clearHideControlsTimer();
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.activeMaterial) {
      await this.plugin.saveMaterial(this.activeMaterial);
    }
  }

  async refresh(): Promise<void> {
    this.materials = await this.plugin.storage.listMaterials();
    if (this.activeMaterial) {
      this.activeMaterial =
        this.materials.find(
          (material) => material.id === this.activeMaterial?.id
        ) ?? null;
      if (!this.activeMaterial) {
        this.screen = "library";
      }
    }
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.floatingControlsEl = null;
    this.paperEl = null;
    this.notesPanelEl = null;

    const app = this.contentEl.createDiv({ cls: "kakitori-app" });
    this.renderTopbar(app);
    const main = app.createDiv({ cls: "kakitori-main" });

    if (this.screen === "home" && this.activeMaterial) {
      this.renderArticleHome(main, this.activeMaterial);
      return;
    }
    if (this.screen === "paper" && this.activeMaterial) {
      this.renderPaperScreen(main, this.activeMaterial);
      return;
    }
    if (this.screen === "card" && this.activeMaterial) {
      this.renderCardScreen(main, this.activeMaterial);
      return;
    }
    this.renderLibrary(main);
  }

  private renderTopbar(app: HTMLElement): void {
    const topbar = app.createDiv({ cls: "kakitori-topbar" });
    const brand = topbar.createEl("button", {
      cls: "kakitori-brand",
      attr: { "aria-label": "返回素材库" }
    });
    brand.createSpan({ cls: "kakitori-brand-mark", text: "書" });
    brand.createSpan({ text: "Kakitori" });
    brand.addEventListener("click", () => {
      this.openLibrary();
    });

    const breadcrumbs = topbar.createDiv({ cls: "kakitori-breadcrumbs" });
    if (this.activeMaterial && this.screen !== "library") {
      const libraryButton = breadcrumbs.createEl("button", { text: "素材库" });
      libraryButton.addEventListener("click", () => this.openLibrary());
      breadcrumbs.createSpan({ text: "/" });
      if (this.screen === "paper" || this.screen === "card") {
        const articleButton = breadcrumbs.createEl("button", {
          text: this.activeMaterial.title
        });
        articleButton.addEventListener("click", () => this.openArticleHome());
        breadcrumbs.createSpan({ text: "/" });
        breadcrumbs.createSpan({
          text: this.screen === "paper" ? "原稿用紙" : "卡片练习"
        });
      } else {
        breadcrumbs.createSpan({ text: this.activeMaterial.title });
      }
    }

    const actions = topbar.createDiv({ cls: "kakitori-topbar-actions" });
    if (this.screen === "library") {
      const importButton = actions.createEl("button", {
        cls: "mod-cta",
        text: "＋ 导入"
      });
      importButton.addEventListener("click", () => this.openImportModal());
    }
  }

  private renderLibrary(main: HTMLElement): void {
    const heading = main.createDiv({ cls: "kakitori-page-heading" });
    const headingText = heading.createDiv();
    headingText.createEl("h1", { text: "素材库" });
    headingText.createEl("p", {
      text: "只显示通过 Kakitori 专门导入的听写素材。"
    });

    if (this.materials.length === 0) {
      const empty = main.createDiv({ cls: "kakitori-empty-state" });
      const icon = empty.createDiv({ cls: "kakitori-empty-icon" });
      setIcon(icon, "notebook-pen");
      empty.createEl("h2", { text: "导入第一篇日语文章" });
      empty.createEl("p", {
        text: "可以粘贴文字，也可以拖入 .txt 或 .md 文件。"
      });
      const button = empty.createEl("button", {
        cls: "mod-cta",
        text: "导入素材"
      });
      button.addEventListener("click", () => this.openImportModal());
      return;
    }

    const grid = main.createDiv({ cls: "kakitori-library-grid" });
    for (const material of this.materials) {
      const card = grid.createEl("button", {
        cls: "kakitori-material-card"
      });
      const titleRow = card.createDiv({ cls: "kakitori-card-title-row" });
      titleRow.createEl("h2", { text: material.title });
      const direction = titleRow.createSpan({
        cls: "kakitori-direction-badge",
        text: material.direction === "vertical" ? "竖排" : "横排"
      });
      direction.setAttribute("aria-label", `当前${direction.textContent}`);
      card.createEl("p", {
        cls: "kakitori-card-preview",
        text: material.sentences
          .slice(0, 4)
          .map((sentence, index) =>
            index > 0 && sentence.startsParagraph
              ? `\n${sentence.text}`
              : sentence.text
          )
          .join("")
      });
      const meta = card.createDiv({ cls: "kakitori-card-meta" });
      meta.createSpan({
        text: `${countWritingCharacters(material.sourceText)} 字`
      });
      meta.createSpan({ text: `${material.sentences.length} 句` });
      meta.createSpan({
        text: `${countParagraphs(material.sourceText)} 段`
      });
      const pageCount = getPaperPageCount(material.sentences);
      meta.createSpan({
        text:
          material.lastPaperPage > 0
            ? `原稿纸 ${material.lastPaperPage + 1}/${pageCount}`
            : "尚未开始"
      });
      card.addEventListener("click", () => {
        this.activeMaterial = material;
        this.screen = "home";
        this.render();
      });
    }
  }

  private renderArticleHome(
    main: HTMLElement,
    material: KakitoriMaterial
  ): void {
    const hero = main.createDiv({ cls: "kakitori-article-hero" });
    const back = hero.createEl("button", {
      cls: "kakitori-icon-button",
      attr: { "aria-label": "返回素材库" }
    });
    setIcon(back, "arrow-left");
    back.addEventListener("click", () => this.openLibrary());
    const copy = hero.createDiv();
    copy.createEl("p", { cls: "kakitori-eyebrow", text: "听写素材" });
    copy.createEl("h1", { text: material.title });
    const stats = copy.createDiv({ cls: "kakitori-article-stats" });
    stats.createSpan({
      text: `${countWritingCharacters(material.sourceText)} 字`
    });
    stats.createSpan({ text: `${material.sentences.length} 句` });
    stats.createSpan({
      text: `${countParagraphs(material.sourceText)} 段`
    });
    stats.createSpan({
      text: `${getPaperPageCount(material.sentences)} 页原稿纸`
    });

    const modes = main.createDiv({ cls: "kakitori-mode-grid" });
    const paperMode = modes.createEl("button", {
      cls: "kakitori-mode-card kakitori-mode-card-primary"
    });
    const paperIcon = paperMode.createDiv({ cls: "kakitori-mode-icon" });
    paperIcon.createDiv({ cls: "kakitori-paper-mode-glyph" });
    paperMode.createEl("h2", { text: "原稿用紙" });
    paperMode.createEl("p", {
      text: "在标准 20×20 原稿纸上逐句听写、揭示和记录。"
    });
    paperMode.createDiv({
      cls: "kakitori-mode-progress",
      text:
        material.lastPaperPage > 0
          ? `继续第 ${material.lastPaperPage + 1} 页`
          : "从第 1 页开始"
    });
    paperMode.addEventListener("click", () => this.openPaper());

    const cardMode = modes.createEl("button", {
      cls: "kakitori-mode-card"
    });
    const cardIcon = cardMode.createDiv({ cls: "kakitori-mode-icon" });
    cardIcon.createDiv({ cls: "kakitori-card-mode-glyph" });
    cardMode.createEl("h2", { text: "卡片练习" });
    cardMode.createEl("p", {
      text: "逐句听写，支持全文顺序、仅难句和随机练习。"
    });
    const lastCardIndex = material.lastCardSentenceId
      ? material.sentences.findIndex(
          (sentence) => sentence.id === material.lastCardSentenceId
        )
      : -1;
    cardMode.createDiv({
      cls: "kakitori-mode-progress",
      text:
        lastCardIndex >= 0
          ? `继续第 ${lastCardIndex + 1} 句`
          : "从第 1 句开始"
    });
    cardMode.addEventListener("click", () => this.openCards());

    const progressActions = main.createDiv({
      cls: "kakitori-progress-actions"
    });
    const restartPaper = progressActions.createEl("button", {
      text: "原稿纸从头练习"
    });
    restartPaper.addEventListener("click", () => {
      material.lastPaperPage = 0;
      this.currentPage = 0;
      this.revealedSentenceIds.clear();
      this.selectedSentenceId = null;
      this.pinnedSentenceId = null;
      void this.plugin.saveMaterial(material);
      this.screen = "paper";
      this.render();
    });
    const restartCards = progressActions.createEl("button", {
      text: "卡片从头练习"
    });
    restartCards.addEventListener("click", () => {
      material.lastCardSentenceId = null;
      this.cardDeckMode = "all";
      this.cardSequenceIds = material.sentences.map((sentence) => sentence.id);
      this.currentCardIndex = 0;
      this.cardRevealed = false;
      this.selectedSentenceId = this.cardSequenceIds[0] ?? null;
      void this.plugin.saveMaterial(material);
      this.screen = "card";
      this.render();
    });
    const prepareAudio = progressActions.createEl("button", {
      text: `预生成整篇音频（${material.sentences.length} 句）`
    });
    prepareAudio.addEventListener("click", () => {
      void this.prepareArticleAudio(material, prepareAudio);
    });
    progressActions.createSpan({
      text: "只重置位置与揭示状态，难句和笔记会保留。"
    });

    const noteSection = main.createDiv({ cls: "kakitori-article-note" });
    noteSection.createEl("h2", { text: "全文笔记" });
    const note = noteSection.createEl("textarea", {
      placeholder: "记录这篇文章的用字规律、语感或总结。"
    });
    note.rows = 6;
    note.value = material.fullNote;
    note.addEventListener("input", () => {
      material.fullNote = note.value;
      this.scheduleSave();
    });
  }

  private renderPaperScreen(
    main: HTMLElement,
    material: KakitoriMaterial
  ): void {
    const pageCount = getPaperPageCount(material.sentences);
    this.currentPage = Math.min(Math.max(this.currentPage, 0), pageCount - 1);
    const layout = buildPaperPageLayout(
      material.sentences,
      this.currentPage,
      material.direction
    );
    const pageSentenceIds = new Set(
      layout.characters.map((character) => character.sentenceId)
    );
    if (
      !this.selectedSentenceId ||
      !pageSentenceIds.has(this.selectedSentenceId)
    ) {
      this.selectedSentenceId =
        layout.characters[0]?.sentenceId ?? material.sentences[0]?.id ?? null;
    }

    const header = main.createDiv({ cls: "kakitori-practice-header" });
    const left = header.createDiv({ cls: "kakitori-practice-title" });
    const back = left.createEl("button", {
      cls: "kakitori-icon-button",
      attr: { "aria-label": "返回文章主页" }
    });
    setIcon(back, "arrow-left");
    back.addEventListener("click", () => this.openArticleHome());
    const title = left.createDiv();
    title.createEl("h1", { text: material.title });
    title.createEl("p", {
      text: `第 ${this.currentPage + 1} / ${layout.pageCount} 页`
    });

    const tools = header.createDiv({ cls: "kakitori-practice-tools" });
    this.createDirectionSwitch(tools, material);
    const concealAll = tools.createEl("button", { text: "全部遮住" });
    concealAll.addEventListener("click", () => {
      this.revealedSentenceIds.clear();
      this.render();
    });
    const revealAll = tools.createEl("button", { text: "全部揭示" });
    revealAll.addEventListener("click", () => {
      new ConfirmModal(
        this.app,
        "揭示全部原文？",
        "这会显示整篇文章的答案。",
        "全部揭示",
        () => {
          for (const sentence of material.sentences) {
            this.revealedSentenceIds.add(sentence.id);
          }
          this.render();
        }
      ).open();
    });

    const workspace = main.createDiv({
      cls: `kakitori-practice-workspace${
        this.notesCollapsed ? " is-notes-collapsed" : ""
      }`
    });
    const paperArea = workspace.createDiv({ cls: "kakitori-paper-area" });
    this.renderPaper(paperArea, material, layout);
    this.renderPagination(paperArea, material, layout.pageCount);
    this.notesPanelEl = workspace.createDiv({
      cls: "kakitori-notes-panel"
    });
    this.renderNotesPanel(material);
  }

  private renderCardScreen(
    main: HTMLElement,
    material: KakitoriMaterial
  ): void {
    if (this.cardSequenceIds.length === 0 && this.cardDeckMode === "all") {
      this.cardSequenceIds = this.buildCardSequence(material, "all");
    }
    this.currentCardIndex = Math.min(
      Math.max(this.currentCardIndex, 0),
      Math.max(0, this.cardSequenceIds.length - 1)
    );
    const sentenceId = this.cardSequenceIds[this.currentCardIndex] ?? null;
    const sentence =
      material.sentences.find((item) => item.id === sentenceId) ?? null;
    this.selectedSentenceId = sentence?.id ?? null;
    this.syncCardRevealState(sentence?.id ?? null);

    const header = main.createDiv({ cls: "kakitori-practice-header" });
    const left = header.createDiv({ cls: "kakitori-practice-title" });
    const back = left.createEl("button", {
      cls: "kakitori-icon-button",
      attr: { "aria-label": "返回文章主页" }
    });
    setIcon(back, "arrow-left");
    back.addEventListener("click", () => this.openArticleHome());
    const title = left.createDiv();
    title.createEl("h1", { text: material.title });
    title.createEl("p", {
      text:
        this.cardSequenceIds.length > 0
          ? this.cardRevealed &&
            this.currentCardIndex === this.cardSequenceIds.length - 1
            ? `本轮完成 · 第 ${this.currentCardIndex + 1} / ${this.cardSequenceIds.length} 句`
            : `第 ${this.currentCardIndex + 1} / ${this.cardSequenceIds.length} 句`
          : "当前卡组没有句子"
    });

    const tools = header.createDiv({ cls: "kakitori-practice-tools" });
    this.createCardDeckSwitch(tools, material);
    this.createDirectionSwitch(tools, material);

    const workspace = main.createDiv({
      cls: `kakitori-practice-workspace${
        this.notesCollapsed ? " is-notes-collapsed" : ""
      }`
    });
    const cardArea = workspace.createDiv({ cls: "kakitori-card-practice-area" });
    if (sentence) {
      this.renderPracticeCard(cardArea, material, sentence.id);
    } else {
      const empty = cardArea.createDiv({ cls: "kakitori-card-deck-empty" });
      empty.createEl("h2", {
        text:
          this.cardDeckMode === "difficult"
            ? "还没有标记难句"
            : "当前卡组没有句子"
      });
      empty.createEl("p", {
        text:
          this.cardDeckMode === "difficult"
            ? "在右侧“本句”中标记难句后，就能集中练习。"
            : "请切换到其他卡组。"
      });
    }
    this.notesPanelEl = workspace.createDiv({
      cls: "kakitori-notes-panel"
    });
    this.renderNotesPanel(material);
  }

  private renderPracticeCard(
    cardArea: HTMLElement,
    material: KakitoriMaterial,
    sentenceId: string
  ): void {
    const sentence = material.sentences.find((item) => item.id === sentenceId);
    if (!sentence) {
      return;
    }
    const card = cardArea.createDiv({
      cls: `kakitori-practice-card is-${material.direction}${
        this.cardRevealed ? " is-revealed" : ""
      }`,
      attr: {
        role: "button",
        tabindex: "0",
        "aria-label": this.cardRevealed ? "重新遮住答案" : "揭示答案"
      }
    });
    if (this.cardRevealed) {
      card.createDiv({
        cls: "kakitori-card-answer",
        text: sentence.text
      });
    } else {
      const blank = card.createDiv({ cls: "kakitori-card-blank" });
      const icon = blank.createDiv({ cls: "kakitori-card-listen-icon" });
      setIcon(icon, "headphones");
      blank.createEl("p", { text: "播放后听写，双击或按 Enter 揭示" });
    }
    card.addEventListener("dblclick", () => this.toggleCardReveal());
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        this.toggleCardReveal();
      }
    });

    const controls = cardArea.createDiv({ cls: "kakitori-card-controls" });
    const previous = controls.createEl("button", { text: "← 上一句" });
    previous.disabled = this.currentCardIndex === 0;
    previous.addEventListener("click", () => this.changeCard(-1, material));

    const playback = controls.createDiv({
      cls: "kakitori-card-playback-controls"
    });
    const play = playback.createEl("button", {
      attr: { "aria-label": "播放", title: "播放" }
    });
    setIcon(play, "play");
    play.addEventListener("click", () => {
      void this.playSelectedSentence();
    });
    const replay = playback.createEl("button", {
      attr: { "aria-label": "重听", title: "重听" }
    });
    setIcon(replay, "rotate-ccw");
    replay.addEventListener("click", () => {
      void this.playSelectedSentence();
    });
    const speed = playback.createEl("button", {
      cls: "kakitori-card-speed",
      text: `${this.playbackSpeed}x`
    });
    speed.addEventListener("click", () => {
      this.playbackSpeed = this.nextPlaybackSpeed();
      speed.setText(`${this.playbackSpeed}x`);
    });
    const reveal = playback.createEl("button", {
      text: this.cardRevealed ? "重新遮住" : "揭示"
    });
    reveal.addEventListener("click", () => this.toggleCardReveal());

    const next = controls.createEl("button", { text: "下一句 →" });
    next.disabled = this.currentCardIndex >= this.cardSequenceIds.length - 1;
    next.addEventListener("click", () => this.changeCard(1, material));
  }

  private renderPaper(
    paperArea: HTMLElement,
    material: KakitoriMaterial,
    layout: PaperPageLayout
  ): void {
    const shell = paperArea.createDiv({ cls: "kakitori-paper-shell" });
    if (layout.continuesFromPrevious) {
      shell.createDiv({
        cls: "kakitori-continuation is-previous",
        text: "← 上页续"
      });
    }
    const paper = shell.createDiv({
      cls: `kakitori-paper is-${material.direction}`
    });
    this.paperEl = paper;

    for (const character of layout.characters) {
      const cell = paper.createSpan({
        cls: "kakitori-paper-character",
        text: character.character
      });
      cell.style.gridColumn = `${character.column + 1}`;
      cell.style.gridRow = `${character.row + 1}`;
    }

    for (const segment of layout.masks) {
      const isRevealed = this.revealedSentenceIds.has(segment.sentenceId);
      const sentenceIndex = material.sentences.findIndex(
        (sentence) => sentence.id === segment.sentenceId
      );
      const region = paper.createDiv({
        cls: [
          "kakitori-sentence-region",
          isRevealed ? "is-revealed" : "kakitori-mask",
          `is-tone-${Math.max(0, sentenceIndex) % 4}`,
          segment.isSentenceStart ? "is-sentence-start" : "",
          segment.isSentenceEnd ? "is-sentence-end" : ""
        ]
          .filter(Boolean)
          .join(" ")
      });
      region.dataset.sentenceId = segment.sentenceId;
      region.setAttribute("role", "button");
      region.setAttribute("tabindex", "0");
      region.setAttribute(
        "aria-label",
        isRevealed ? "已揭示的听写句子" : "遮住的听写句子"
      );
      region.style.left = `${segment.leftPercent}%`;
      region.style.top = `${segment.topPercent}%`;
      region.style.width = `${segment.widthPercent}%`;
      region.style.height = `${segment.heightPercent}%`;

      if (this.plugin.kakitoriSettings.showSentenceNumbersOnHover) {
        region.createSpan({
          cls: "kakitori-mask-number",
          text: `${sentenceIndex + 1}`
        });
      }

      region.addEventListener("mouseenter", () => {
        this.clearHideControlsTimer();
        if (!this.pinnedSentenceId) {
          this.showFloatingControls(segment.sentenceId, material);
        }
      });
      region.addEventListener("mouseleave", () => {
        this.scheduleHideControls();
      });
      region.addEventListener("click", (event) => {
        event.stopPropagation();
        if (event.detail > 1) {
          return;
        }
        this.selectAndPinSentence(segment.sentenceId, material);
      });
      region.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        this.toggleSentenceReveal(segment.sentenceId);
      });
      region.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.toggleSentenceReveal(segment.sentenceId);
        }
        if (event.key === " ") {
          event.preventDefault();
          this.selectAndPinSentence(segment.sentenceId, material);
        }
      });
    }

    this.updateSentenceRegionClasses();
    paper.addEventListener("mouseleave", () => this.scheduleHideControls());
    if (this.pinnedSentenceId) {
      this.showFloatingControls(this.pinnedSentenceId, material);
    }
    if (layout.continuesOnNext) {
      shell.createDiv({
        cls: "kakitori-continuation is-next",
        text: "下页续 →"
      });
    }
  }

  private renderPagination(
    paperArea: HTMLElement,
    material: KakitoriMaterial,
    pageCount: number
  ): void {
    const pagination = paperArea.createDiv({ cls: "kakitori-pagination" });
    const previous = pagination.createEl("button", { text: "← 上一页" });
    previous.disabled = this.currentPage === 0;
    previous.addEventListener("click", () => {
      this.changePage(-1, material);
    });
    pagination.createSpan({
      text: `${this.currentPage + 1} / ${pageCount}`
    });
    const next = pagination.createEl("button", { text: "下一页 →" });
    next.disabled = this.currentPage >= pageCount - 1;
    next.addEventListener("click", () => {
      this.changePage(1, material);
    });
  }

  private renderNotesPanel(material: KakitoriMaterial): void {
    const panel = this.notesPanelEl;
    if (!panel) {
      return;
    }
    panel.empty();
    const header = panel.createDiv({ cls: "kakitori-notes-header" });
    header.createEl("h2", { text: "学习笔记" });
    const collapse = header.createEl("button", {
      cls: "kakitori-icon-button",
      attr: {
        "aria-label": this.notesCollapsed ? "展开笔记" : "收起笔记"
      }
    });
    setIcon(collapse, this.notesCollapsed ? "panel-right-open" : "panel-right-close");
    collapse.addEventListener("click", () => {
      this.notesCollapsed = !this.notesCollapsed;
      this.render();
    });

    if (this.notesCollapsed) {
      return;
    }

    const tabs = panel.createDiv({ cls: "kakitori-notes-tabs" });
    const tabDefinitions: Array<{ id: NotesTab; label: string }> = [
      { id: "sentence", label: "本句" },
      { id: "vocabulary", label: "生词・短语" },
      { id: "article", label: "全文笔记" }
    ];
    for (const definition of tabDefinitions) {
      const button = tabs.createEl("button", {
        cls: this.notesTab === definition.id ? "is-active" : "",
        text: definition.label
      });
      button.addEventListener("click", () => {
        this.notesTab = definition.id;
        this.renderNotesPanel(material);
      });
    }

    const body = panel.createDiv({ cls: "kakitori-notes-body" });
    if (this.notesTab === "vocabulary") {
      body.createEl("p", {
        cls: "kakitori-muted",
        text: "选择已揭示原文加入生词的功能将在下一阶段接入。"
      });
      return;
    }
    if (this.notesTab === "article") {
      body.createEl("label", { text: "整篇文章的规律与总结" });
      const textarea = body.createEl("textarea", {
        placeholder: "例如：哪些词通常写汉字，哪些表达更常用假名。"
      });
      textarea.rows = 12;
      textarea.value = material.fullNote;
      textarea.addEventListener("input", () => {
        material.fullNote = textarea.value;
        this.scheduleSave();
      });
      return;
    }

    const sentence = material.sentences.find(
      (candidate) => candidate.id === this.selectedSentenceId
    );
    if (!sentence) {
      body.createEl("p", {
        cls: "kakitori-muted",
        text: "单击一句遮罩后，可以在这里记录。"
      });
      return;
    }
    const isRevealed = this.revealedSentenceIds.has(sentence.id);
    body.createDiv({
      cls: `kakitori-sentence-status ${isRevealed ? "is-revealed" : ""}`,
      text: isRevealed ? "已揭示" : "待核对"
    });
    if (isRevealed) {
      body.createDiv({
        cls: "kakitori-revealed-text",
        text: sentence.text
      });
      const reconceal = body.createEl("button", {
        cls: "kakitori-reconceal-button",
        text: "重新遮住本句"
      });
      reconceal.addEventListener("click", () => {
        this.revealedSentenceIds.delete(sentence.id);
        this.render();
      });
    }

    const difficultLabel = body.createEl("label", {
      cls: "kakitori-check-field"
    });
    const difficult = difficultLabel.createEl("input", {
      type: "checkbox"
    });
    difficult.checked = sentence.difficult;
    difficultLabel.createSpan({ text: "标记为难句" });
    difficult.addEventListener("change", () => {
      sentence.difficult = difficult.checked;
      this.scheduleSave();
      if (this.screen === "card" && this.cardDeckMode === "difficult") {
        this.cardSequenceIds = this.buildCardSequence(material, "difficult");
        this.currentCardIndex = Math.min(
          this.currentCardIndex,
          Math.max(0, this.cardSequenceIds.length - 1)
        );
        this.cardRevealed = false;
        this.selectedSentenceId =
          this.cardSequenceIds[this.currentCardIndex] ?? null;
        if (this.selectedSentenceId) {
          material.lastCardSentenceId = this.selectedSentenceId;
        }
        this.render();
      }
    });

    body.createEl("label", { text: "本句速记" });
    const note = body.createEl("textarea", {
      placeholder: "记录写错的汉字、假名或语感。"
    });
    note.rows = 8;
    note.value = sentence.note;
    note.addEventListener("input", () => {
      sentence.note = note.value;
      this.scheduleSave();
    });
  }

  private createDirectionSwitch(
    container: HTMLElement,
    material: KakitoriMaterial
  ): void {
    const group = container.createDiv({
      cls: "kakitori-segmented-control"
    });
    for (const direction of ["vertical", "horizontal"] as const) {
      const button = group.createEl("button", {
        cls: material.direction === direction ? "is-active" : "",
        text: direction === "vertical" ? "竖排" : "横排"
      });
      button.addEventListener("click", () => {
        void this.setDirection(material, direction);
      });
    }
  }

  private createCardDeckSwitch(
    container: HTMLElement,
    material: KakitoriMaterial
  ): void {
    const group = container.createDiv({
      cls: "kakitori-segmented-control kakitori-card-deck-switch"
    });
    const modes: Array<{ id: CardDeckMode; label: string }> = [
      { id: "all", label: "全文顺序" },
      { id: "difficult", label: "仅难句" },
      { id: "random", label: "随机" }
    ];
    for (const mode of modes) {
      const button = group.createEl("button", {
        cls: this.cardDeckMode === mode.id ? "is-active" : "",
        text: mode.label
      });
      button.addEventListener("click", () => {
        this.setCardDeckMode(material, mode.id);
      });
    }
  }

  private setCardDeckMode(
    material: KakitoriMaterial,
    mode: CardDeckMode
  ): void {
    this.cardDeckMode = mode;
    this.cardSequenceIds = this.buildCardSequence(material, mode);
    this.currentCardIndex = 0;
    this.cardRevealed = false;
    this.selectedSentenceId = this.cardSequenceIds[0] ?? null;
    if (this.selectedSentenceId) {
      material.lastCardSentenceId = this.selectedSentenceId;
    }
    this.revealedSentenceIds.clear();
    void this.plugin.saveMaterial(material);
    this.render();
  }

  private buildCardSequence(
    material: KakitoriMaterial,
    mode: CardDeckMode
  ): string[] {
    const sentenceIds = material.sentences
      .filter((sentence) => mode !== "difficult" || sentence.difficult)
      .map((sentence) => sentence.id);
    if (mode !== "random") {
      return sentenceIds;
    }
    for (let index = sentenceIds.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [sentenceIds[index], sentenceIds[swapIndex]] = [
        sentenceIds[swapIndex],
        sentenceIds[index]
      ];
    }
    return sentenceIds;
  }

  private changeCard(delta: number, material: KakitoriMaterial): void {
    const nextIndex = Math.min(
      Math.max(this.currentCardIndex + delta, 0),
      Math.max(0, this.cardSequenceIds.length - 1)
    );
    if (nextIndex === this.currentCardIndex) {
      return;
    }
    this.plugin.tts.stop();
    this.currentCardIndex = nextIndex;
    this.cardRevealed = false;
    this.selectedSentenceId = this.cardSequenceIds[nextIndex] ?? null;
    material.lastCardSentenceId = this.selectedSentenceId;
    this.revealedSentenceIds.clear();
    void this.plugin.saveMaterial(material);
    this.render();
  }

  private toggleCardReveal(): void {
    const sentenceId = this.cardSequenceIds[this.currentCardIndex];
    if (!sentenceId) {
      return;
    }
    this.cardRevealed = !this.cardRevealed;
    this.syncCardRevealState(sentenceId);
    this.render();
  }

  private syncCardRevealState(sentenceId: string | null): void {
    this.revealedSentenceIds.clear();
    if (sentenceId && this.cardRevealed) {
      this.revealedSentenceIds.add(sentenceId);
    }
  }

  private nextPlaybackSpeed(): number {
    return this.playbackSpeed === 1
      ? 0.75
      : this.playbackSpeed === 0.75
        ? 1.25
        : 1;
  }

  private async setDirection(
    material: KakitoriMaterial,
    direction: WritingDirection
  ): Promise<void> {
    material.direction = direction;
    await this.plugin.saveMaterial(material);
    this.render();
  }

  private selectAndPinSentence(
    sentenceId: string,
    material: KakitoriMaterial
  ): void {
    this.selectedSentenceId = sentenceId;
    this.pinnedSentenceId =
      this.pinnedSentenceId === sentenceId ? null : sentenceId;
    this.updateSentenceRegionClasses();
    this.renderNotesPanel(material);
    if (this.pinnedSentenceId) {
      this.showFloatingControls(sentenceId, material);
    } else {
      this.removeFloatingControls();
    }
  }

  private showFloatingControls(
    sentenceId: string,
    material: KakitoriMaterial
  ): void {
    const paper = this.paperEl;
    if (!paper) {
      return;
    }
    const isRevealed = this.revealedSentenceIds.has(sentenceId);
    this.clearHideControlsTimer();
    this.removeFloatingControls();

    const controls = paper.createDiv({
      cls: `kakitori-floating-controls is-${material.direction}`
    });
    this.floatingControlsEl = controls;
    controls.dataset.sentenceId = sentenceId;
    controls.addEventListener("mouseenter", () => {
      this.clearHideControlsTimer();
    });
    controls.addEventListener("mouseleave", () => {
      this.scheduleHideControls();
    });

    if (this.plugin.kakitoriSettings.showSentenceNumbersOnHover) {
      const index = material.sentences.findIndex(
        (sentence) => sentence.id === sentenceId
      );
      controls.createSpan({
        cls: "kakitori-floating-number",
        text: `第 ${index + 1} 句`
      });
    }

    this.createControlButton(controls, "播放", "play", () => {
      void this.playSelectedSentence();
    });
    this.createControlButton(controls, "重听", "rotate-ccw", () => {
      void this.playSelectedSentence();
    });
    const speed = controls.createEl("button", {
      attr: { "aria-label": "语速" },
      text: `${this.playbackSpeed}×`
    });
    speed.addEventListener("click", (event) => {
      event.stopPropagation();
      this.playbackSpeed = this.nextPlaybackSpeed();
      speed.setText(`${this.playbackSpeed}×`);
    });
    this.createControlButton(
      controls,
      isRevealed ? "重新遮住" : "揭示",
      isRevealed ? "eye-off" : "eye",
      () => {
        this.toggleSentenceReveal(sentenceId);
      }
    );
    this.createControlButton(
      controls,
      this.pinnedSentenceId === sentenceId ? "取消固定" : "固定",
      this.pinnedSentenceId === sentenceId ? "pin-off" : "pin",
      () => {
        this.selectAndPinSentence(sentenceId, material);
      }
    );

    window.requestAnimationFrame(() => {
      this.positionFloatingControls(sentenceId, controls, material.direction);
    });
  }

  private createControlButton(
    container: HTMLElement,
    label: string,
    iconName: string,
    onClick: () => void
  ): void {
    const button = container.createEl("button", {
      attr: { "aria-label": label, title: label }
    });
    setIcon(button, iconName);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  }

  private positionFloatingControls(
    sentenceId: string,
    controls: HTMLElement,
    direction: WritingDirection
  ): void {
    const paper = this.paperEl;
    if (!paper || !controls.isConnected) {
      return;
    }
    const regions = Array.from(
      paper.querySelectorAll<HTMLElement>(".kakitori-sentence-region")
    ).filter((region) => region.dataset.sentenceId === sentenceId);
    if (regions.length === 0) {
      return;
    }

    const paperRect = paper.getBoundingClientRect();
    const regionRects = regions.map((region) => region.getBoundingClientRect());
    const left =
      Math.min(...regionRects.map((rect) => rect.left)) - paperRect.left;
    const right =
      Math.max(...regionRects.map((rect) => rect.right)) - paperRect.left;
    const top =
      Math.min(...regionRects.map((rect) => rect.top)) - paperRect.top;
    const bottom =
      Math.max(...regionRects.map((rect) => rect.bottom)) - paperRect.top;
    const controlsWidth = controls.offsetWidth;
    const controlsHeight = controls.offsetHeight;

    if (direction === "vertical") {
      let x = right + 8;
      if (x + controlsWidth > paper.clientWidth - 8) {
        x = left - controlsWidth - 8;
      }
      controls.style.left = `${Math.max(8, x)}px`;
      controls.style.top = `${Math.min(
        Math.max(8, top),
        paper.clientHeight - controlsHeight - 8
      )}px`;
      return;
    }

    let y = bottom + 8;
    if (y + controlsHeight > paper.clientHeight - 8) {
      y = top - controlsHeight - 8;
    }
    controls.style.left = `${Math.min(
      Math.max(8, left),
      paper.clientWidth - controlsWidth - 8
    )}px`;
    controls.style.top = `${Math.max(8, y)}px`;
  }

  private updateSentenceRegionClasses(): void {
    if (!this.paperEl) {
      return;
    }
    for (const region of Array.from(
      this.paperEl.querySelectorAll<HTMLElement>(
        ".kakitori-sentence-region"
      )
    )) {
      const sentenceId = region.dataset.sentenceId;
      region.classList.toggle(
        "is-selected",
        sentenceId === this.selectedSentenceId
      );
      region.classList.toggle(
        "is-pinned",
        sentenceId === this.pinnedSentenceId
      );
    }
  }

  private toggleSentenceReveal(sentenceId: string): void {
    this.selectedSentenceId = sentenceId;
    if (this.revealedSentenceIds.has(sentenceId)) {
      this.revealedSentenceIds.delete(sentenceId);
    } else {
      this.revealedSentenceIds.add(sentenceId);
    }
    this.render();
  }

  private changePage(delta: number, material: KakitoriMaterial): void {
    this.plugin.tts.stop();
    const pageCount = getPaperPageCount(material.sentences);
    this.currentPage = Math.min(
      Math.max(this.currentPage + delta, 0),
      pageCount - 1
    );
    material.lastPaperPage = this.currentPage;
    this.selectedSentenceId = null;
    this.pinnedSentenceId = null;
    void this.plugin.saveMaterial(material);
    this.render();
  }

  private openImportModal(): void {
    new ImportMaterialModal(this.app, async (imported) => {
      const material = await this.plugin.importMaterial(imported);
      this.materials = [material, ...this.materials];
      this.activeMaterial = material;
      this.screen = "home";
      this.render();
    }).open();
  }

  private openLibrary(): void {
    this.plugin.tts.stop();
    this.screen = "library";
    this.activeMaterial = null;
    this.revealedSentenceIds.clear();
    this.cardSequenceIds = [];
    this.cardRevealed = false;
    this.selectedSentenceId = null;
    this.pinnedSentenceId = null;
    this.render();
  }

  private openArticleHome(): void {
    this.plugin.tts.stop();
    this.screen = "home";
    this.revealedSentenceIds.clear();
    this.cardSequenceIds = [];
    this.cardRevealed = false;
    this.selectedSentenceId = null;
    this.pinnedSentenceId = null;
    this.render();
  }

  private openPaper(): void {
    const material = this.activeMaterial;
    if (!material) {
      return;
    }
    this.plugin.tts.stop();
    this.currentPage = Math.min(
      material.lastPaperPage,
      getPaperPageCount(material.sentences) - 1
    );
    this.revealedSentenceIds.clear();
    this.selectedSentenceId = null;
    this.pinnedSentenceId = null;
    this.screen = "paper";
    this.render();
  }

  private openCards(): void {
    const material = this.activeMaterial;
    if (!material) {
      return;
    }
    this.plugin.tts.stop();
    this.cardDeckMode = "all";
    this.cardSequenceIds = this.buildCardSequence(material, "all");
    const savedIndex = material.lastCardSentenceId
      ? this.cardSequenceIds.indexOf(material.lastCardSentenceId)
      : -1;
    this.currentCardIndex = savedIndex >= 0 ? savedIndex : 0;
    this.cardRevealed = false;
    this.revealedSentenceIds.clear();
    this.selectedSentenceId =
      this.cardSequenceIds[this.currentCardIndex] ?? null;
    this.pinnedSentenceId = null;
    this.screen = "card";
    this.render();
  }

  private handleKeyboard(event: KeyboardEvent): void {
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLButtonElement
    ) {
      return;
    }
    if (!this.activeMaterial) {
      return;
    }

    if (this.screen === "card") {
      if (event.key === " ") {
        event.preventDefault();
        void this.playSelectedSentence();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void this.playSelectedSentence();
      } else if (event.key === "Enter") {
        event.preventDefault();
        this.toggleCardReveal();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.changeCard(-1, this.activeMaterial);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        this.changeCard(1, this.activeMaterial);
      }
      return;
    }

    if (this.screen !== "paper") {
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      void this.playSelectedSentence();
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      void this.playSelectedSentence();
    } else if (event.key === "Enter" && this.selectedSentenceId) {
      event.preventDefault();
      this.toggleSentenceReveal(this.selectedSentenceId);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.changePage(-1, this.activeMaterial);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      this.changePage(1, this.activeMaterial);
    }
  }

  private async playSelectedSentence(): Promise<void> {
    const material = this.activeMaterial;
    const sentence = material?.sentences.find(
      (candidate) => candidate.id === this.selectedSentenceId
    );
    if (!sentence) {
      new Notice("请先选择一句。");
      return;
    }
    const config = this.getAzureSpeechConfig();
    if (!config) {
      new Notice("请先在 Kakitori 设置中填写 Azure 区域和 Speech 密钥。");
      return;
    }
    try {
      await this.plugin.tts.play(
        sentence.text,
        config,
        this.playbackSpeed
      );
    } catch {
      new Notice("语音播放失败，请检查 Azure 区域、密钥和网络。");
    }
  }

  private async prepareArticleAudio(
    material: KakitoriMaterial,
    button: HTMLButtonElement
  ): Promise<void> {
    const config = this.getAzureSpeechConfig();
    if (!config) {
      new Notice("请先在 Kakitori 设置中填写 Azure 区域和 Speech 密钥。");
      return;
    }
    button.disabled = true;
    const originalText = button.textContent ?? "预生成整篇音频";
    try {
      for (const [index, sentence] of material.sentences.entries()) {
        button.setText(
          `正在生成 ${index + 1} / ${material.sentences.length}`
        );
        await this.plugin.tts.prepare(sentence.text, config);
      }
      new Notice("整篇音频已缓存。");
    } catch {
      new Notice("音频生成中断，请检查 Azure 设置和网络。");
    } finally {
      button.disabled = false;
      button.setText(originalText);
    }
  }

  private getAzureSpeechConfig(): AzureSpeechConfig | null {
    const region = this.plugin.kakitoriSettings.azureRegion.trim();
    const subscriptionKey = this.plugin.getAzureSpeechKey();
    if (!region || !subscriptionKey) {
      return null;
    }
    return {
      region,
      voice: this.plugin.kakitoriSettings.azureVoice,
      subscriptionKey
    };
  }

  private scheduleSave(): void {
    if (!this.activeMaterial) {
      return;
    }
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      if (this.activeMaterial) {
        void this.plugin.saveMaterial(this.activeMaterial);
      }
    }, 350);
  }

  private scheduleHideControls(): void {
    if (this.pinnedSentenceId) {
      return;
    }
    this.clearHideControlsTimer();
    this.hideControlsTimer = window.setTimeout(() => {
      this.removeFloatingControls();
    }, 140);
  }

  private clearHideControlsTimer(): void {
    if (this.hideControlsTimer !== null) {
      window.clearTimeout(this.hideControlsTimer);
      this.hideControlsTimer = null;
    }
  }

  private removeFloatingControls(): void {
    this.floatingControlsEl?.remove();
    this.floatingControlsEl = null;
  }
}
