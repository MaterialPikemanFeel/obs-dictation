import {
  ItemView,
  Menu,
  Notice,
  setIcon
} from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type KakitoriPlugin from "../main";
import { ConfirmModal } from "./confirm-modal";
import { ImportMaterialModal } from "./import-modal";
import { RenameMaterialModal } from "./rename-material-modal";
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
  LibrarySort,
  KakitoriMaterial,
  KakitoriSentence,
  WritingDirection
} from "./types";

export const VIEW_TYPE_KAKITORI = "kakitori-view";

type KakitoriScreen = "library" | "records" | "home" | "paper" | "card";
type NotesTab = "sentence" | "highlights" | "article";
type RecordSort = "article-order" | "recent" | "oldest";

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
  private pendingFocusSentenceId: string | null = null;
  private selectedSentenceId: string | null = null;
  private pinnedSentenceId: string | null = null;
  private notesTab: NotesTab = "sentence";
  private notesCollapsed = false;
  private recordMaterialId: string | null = null;
  private recordSearchQuery = "";
  private recordSort: RecordSort = "article-order";
  private readonly collapsedRecordMaterialIds = new Set<string>();
  private readonly expandedRecordNoteIds = new Set<string>();
  private readonly recordRevealedHighlightIds = new Set<string>();
  private playbackSpeed = 1;
  private floatingControlsEl: HTMLElement | null = null;
  private selectionPopoverEl: HTMLElement | null = null;
  private paperEl: HTMLElement | null = null;
  private notesPanelEl: HTMLElement | null = null;
  private hideControlsTimer: number | null = null;
  private readonly saveTimers = new Map<string, number>();

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
    this.registerDomEvent(document, "mousedown", (event) => {
      if (
        this.selectionPopoverEl &&
        event.target instanceof Node &&
        !this.selectionPopoverEl.contains(event.target)
      ) {
        this.removeSelectionPopover();
      }
    });
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.clearHideControlsTimer();
    this.removeSelectionPopover();
    for (const timer of this.saveTimers.values()) {
      window.clearTimeout(timer);
    }
    const pendingMaterials = this.materials.filter((material) =>
      this.saveTimers.has(material.id)
    );
    this.saveTimers.clear();
    if (
      this.activeMaterial &&
      !pendingMaterials.some(
        (material) => material.id === this.activeMaterial?.id
      )
    ) {
      pendingMaterials.push(this.activeMaterial);
    }
    await Promise.all(
      pendingMaterials.map(async (material) =>
        this.plugin.saveMaterial(material)
      )
    );
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
    this.removeSelectionPopover();
    this.contentEl.empty();
    this.floatingControlsEl = null;
    this.paperEl = null;
    this.notesPanelEl = null;

    const app = this.contentEl.createDiv({ cls: "kakitori-app" });
    this.renderTopbar(app);
    const main = app.createDiv({ cls: "kakitori-main" });

    if (this.screen === "records") {
      main.addClass("is-records");
      this.renderRecords(main);
      return;
    }
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
    if (this.screen === "records") {
      breadcrumbs.createSpan({ text: "记录" });
    } else if (this.activeMaterial && this.screen !== "library") {
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
    const recordCount = this.materials.reduce(
      (count, material) =>
        count +
        material.sentences.filter(
          (sentence) => sentence.highlights.length > 0
        ).length,
      0
    );
    const recordsButton = actions.createEl("button", {
      cls: this.screen === "records" ? "is-active" : "",
      text: recordCount > 0 ? `记录 ${recordCount}` : "记录"
    });
    recordsButton.addEventListener("click", () => this.openRecords());
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

    if (this.materials.length > 0) {
      const sortField = heading.createDiv({
        cls: "kakitori-library-sort"
      });
      sortField.createSpan({ text: "排序" });
      const sort = sortField.createEl("select", {
        attr: {
          "aria-label": "素材排序",
          title: "素材排序"
        }
      });
      const sortOptions: Array<{ value: LibrarySort; label: string }> = [
        { value: "practiced", label: "最近练习" },
        { value: "created", label: "最近创建" },
        { value: "name", label: "名称" }
      ];
      for (const option of sortOptions) {
        sort.createEl("option", {
          text: option.label,
          value: option.value
        });
      }
      sort.value = this.plugin.kakitoriSettings.librarySort;
      sort.addEventListener("change", () => {
        if (
          sort.value === "practiced" ||
          sort.value === "created" ||
          sort.value === "name"
        ) {
          this.plugin.kakitoriSettings.librarySort = sort.value;
          void this.plugin.saveSettings();
          this.render();
        }
      });
    }

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
    for (const material of this.getSortedMaterials()) {
      const card = grid.createDiv({
        cls: "kakitori-material-card"
      });
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      const titleRow = card.createDiv({ cls: "kakitori-card-title-row" });
      titleRow.createEl("h2", { text: material.title });
      const titleActions = titleRow.createDiv({
        cls: "kakitori-card-title-actions"
      });
      const direction = titleActions.createSpan({
        cls: "kakitori-direction-badge",
        text: material.direction === "vertical" ? "竖排" : "横排"
      });
      direction.setAttribute("aria-label", `当前${direction.textContent}`);
      const moreButton = titleActions.createEl("button", {
        cls: "kakitori-card-more",
        attr: {
          "aria-label": `管理「${material.title}」`,
          title: "更多操作"
        }
      });
      setIcon(moreButton, "ellipsis");
      moreButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openMaterialMenu(event, material);
      });
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
      card.addEventListener("click", () => this.openMaterial(material));
      card.addEventListener("keydown", (event) => {
        if (
          event.target === card &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          this.openMaterial(material);
        }
      });
    }
  }

  private getSortedMaterials(): KakitoriMaterial[] {
    const materials = [...this.materials];
    if (this.plugin.kakitoriSettings.librarySort === "name") {
      return materials.sort((left, right) =>
        left.title.localeCompare(right.title, "ja")
      );
    }
    if (this.plugin.kakitoriSettings.librarySort === "created") {
      return materials.sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt)
      );
    }
    return materials.sort((left, right) => {
      if (left.lastPracticedAt && right.lastPracticedAt) {
        return right.lastPracticedAt.localeCompare(left.lastPracticedAt);
      }
      if (left.lastPracticedAt) {
        return -1;
      }
      if (right.lastPracticedAt) {
        return 1;
      }
      return right.createdAt.localeCompare(left.createdAt);
    });
  }

  private renderRecords(main: HTMLElement): void {
    const materialsWithRecords = this.materials
      .map((material) => ({
        material,
        count: material.sentences.filter(
          (sentence) => sentence.highlights.length > 0
        ).length
      }))
      .filter(({ count }) => count > 0)
      .sort((left, right) =>
        left.material.title.localeCompare(right.material.title, "ja")
      );
    const totalCount = materialsWithRecords.reduce(
      (count, entry) => count + entry.count,
      0
    );

    if (
      this.recordMaterialId &&
      !materialsWithRecords.some(
        ({ material }) => material.id === this.recordMaterialId
      )
    ) {
      this.recordMaterialId = null;
    }

    const workspace = main.createDiv({ cls: "kakitori-records-workspace" });
    const sidebar = workspace.createEl("aside", {
      cls: "kakitori-records-sidebar"
    });
    const navigation = sidebar.createDiv({
      cls: "kakitori-records-navigation"
    });
    const libraryButton = navigation.createEl("button");
    setIcon(libraryButton.createSpan(), "library");
    libraryButton.createSpan({ text: "素材库" });
    libraryButton.addEventListener("click", () => this.openLibrary());
    const recordsButton = navigation.createEl("button", {
      cls: "is-active"
    });
    setIcon(recordsButton.createSpan(), "highlighter");
    recordsButton.createSpan({ text: "记录" });
    recordsButton.createSpan({
      cls: "kakitori-sidebar-count",
      text: `${totalCount}`
    });

    const sources = sidebar.createDiv({ cls: "kakitori-record-sources" });
    sources.createDiv({ cls: "kakitori-sidebar-label", text: "来源" });
    const allSources = sources.createEl("button", {
      cls: this.recordMaterialId === null ? "is-active" : ""
    });
    allSources.createSpan({ text: "全部记录" });
    allSources.createSpan({
      cls: "kakitori-sidebar-count",
      text: `${totalCount}`
    });
    allSources.addEventListener("click", () => {
      this.recordMaterialId = null;
      this.render();
    });
    for (const { material, count } of materialsWithRecords) {
      const source = sources.createEl("button", {
        cls: this.recordMaterialId === material.id ? "is-active" : ""
      });
      source.createSpan({
        cls: "kakitori-record-source-name",
        text: material.title
      });
      source.createSpan({
        cls: "kakitori-sidebar-count",
        text: `${count}`
      });
      source.addEventListener("click", () => {
        this.recordMaterialId = material.id;
        this.render();
      });
    }

    const content = workspace.createDiv({ cls: "kakitori-records-content" });
    const heading = content.createDiv({ cls: "kakitori-records-heading" });
    const headingText = heading.createDiv();
    headingText.createEl("h1", { text: "记录" });
    const resultCount = headingText.createEl("p");
    const toolbar = heading.createDiv({ cls: "kakitori-records-toolbar" });
    const searchField = toolbar.createDiv({
      cls: "kakitori-record-search"
    });
    setIcon(searchField.createSpan(), "search");
    const search = searchField.createEl("input", {
      type: "search",
      value: this.recordSearchQuery,
      attr: {
        "aria-label": "搜索记录",
        placeholder: "搜索句子、来源或备注"
      }
    });
    const sort = toolbar.createEl("select", {
      attr: {
        "aria-label": "记录排序",
        title: "记录排序"
      }
    });
    const sortOptions: Array<{ value: RecordSort; label: string }> = [
      { value: "article-order", label: "原文顺序" },
      { value: "recent", label: "最近记录" },
      { value: "oldest", label: "最早记录" }
    ];
    for (const option of sortOptions) {
      sort.createEl("option", {
        text: option.label,
        value: option.value
      });
    }
    sort.value = this.recordSort;

    const results = content.createDiv({ cls: "kakitori-record-results" });
    const renderResults = (): void => {
      results.empty();
      this.renderRecordResults(results, resultCount);
    };
    search.addEventListener("input", () => {
      this.recordSearchQuery = search.value;
      renderResults();
    });
    sort.addEventListener("change", () => {
      if (
        sort.value === "article-order" ||
        sort.value === "recent" ||
        sort.value === "oldest"
      ) {
        this.recordSort = sort.value;
        renderResults();
      }
    });
    renderResults();
  }

  private renderRecordResults(
    container: HTMLElement,
    resultCount: HTMLElement
  ): void {
    const query = this.recordSearchQuery.trim().toLocaleLowerCase();
    const groups = this.materials
      .filter(
        (material) =>
          this.recordMaterialId === null ||
          material.id === this.recordMaterialId
      )
      .map((material) => {
        const sourceMatches = material.title
          .toLocaleLowerCase()
          .includes(query);
        const records = material.sentences
          .map((sentence, index) => ({ sentence, index }))
          .filter(
            ({ sentence }) =>
              sentence.highlights.length > 0 &&
              (sourceMatches ||
                sentence.text.toLocaleLowerCase().includes(query) ||
                sentence.note.toLocaleLowerCase().includes(query))
          );
        records.sort((left, right) => {
          if (this.recordSort === "article-order") {
            return left.index - right.index;
          }
          const leftDate =
            left.sentence.recordedAt ?? material.updatedAt;
          const rightDate =
            right.sentence.recordedAt ?? material.updatedAt;
          return this.recordSort === "recent"
            ? rightDate.localeCompare(leftDate)
            : leftDate.localeCompare(rightDate);
        });
        return { material, records };
      })
      .filter(({ records }) => records.length > 0)
      .sort((left, right) => {
        if (this.recordSort === "article-order") {
          return left.material.title.localeCompare(
            right.material.title,
            "ja"
          );
        }
        const leftDate =
          left.records[0]?.sentence.recordedAt ??
          left.material.updatedAt;
        const rightDate =
          right.records[0]?.sentence.recordedAt ??
          right.material.updatedAt;
        return this.recordSort === "recent"
          ? rightDate.localeCompare(leftDate)
          : leftDate.localeCompare(rightDate);
      });
    const visibleCount = groups.reduce(
      (count, group) => count + group.records.length,
      0
    );
    resultCount.setText(
      this.recordSearchQuery.trim() || this.recordMaterialId
        ? `显示 ${visibleCount} 条记录`
        : `共 ${visibleCount} 条记录，按来源文章整理。`
    );

    if (visibleCount === 0) {
      const empty = container.createDiv({ cls: "kakitori-empty-state" });
      const icon = empty.createDiv({ cls: "kakitori-empty-icon" });
      setIcon(icon, this.materials.some((material) =>
        material.sentences.some(
          (sentence) => sentence.highlights.length > 0
        )
      ) ? "search-x" : "highlighter");
      empty.createEl("h2", {
        text:
          this.recordSearchQuery.trim() || this.recordMaterialId
            ? "没有符合条件的记录"
            : "还没有记录"
      });
      empty.createEl("p", {
        text:
          this.recordSearchQuery.trim() || this.recordMaterialId
            ? "可以修改搜索内容，或在左侧切换来源。"
            : "揭示句子后选中文字，再点击“高亮并记录”。"
      });
      return;
    }

    for (const { material, records } of groups) {
      const group = container.createDiv({ cls: "kakitori-record-group" });
      const groupHeader = group.createEl("button", {
        cls: "kakitori-record-group-header"
      });
      const groupTitle = groupHeader.createDiv();
      const chevron = groupTitle.createSpan({
        cls: "kakitori-record-group-chevron"
      });
      setIcon(chevron, "chevron-down");
      groupTitle.createEl("h2", { text: material.title });
      groupTitle.createSpan({
        cls: "kakitori-record-group-count",
        text: `${records.length} 条`
      });
      const isCollapsed = this.collapsedRecordMaterialIds.has(material.id);
      group.classList.toggle("is-collapsed", isCollapsed);
      groupHeader.setAttribute("aria-expanded", `${!isCollapsed}`);
      groupHeader.addEventListener("click", () => {
        if (this.collapsedRecordMaterialIds.has(material.id)) {
          this.collapsedRecordMaterialIds.delete(material.id);
        } else {
          this.collapsedRecordMaterialIds.add(material.id);
        }
        group.classList.toggle(
          "is-collapsed",
          this.collapsedRecordMaterialIds.has(material.id)
        );
        groupHeader.setAttribute(
          "aria-expanded",
          `${!this.collapsedRecordMaterialIds.has(material.id)}`
        );
      });

      const list = group.createDiv({ cls: "kakitori-record-list" });
      for (const { sentence, index } of records) {
        this.renderRecordCard(list, material, sentence, index);
      }
    }
  }

  private renderRecordCard(
    container: HTMLElement,
    material: KakitoriMaterial,
    sentence: KakitoriSentence,
    sentenceIndex: number
  ): void {
    const card = container.createDiv({ cls: "kakitori-record-card" });
    const header = card.createDiv({ cls: "kakitori-record-header" });
    const meta = header.createDiv({ cls: "kakitori-record-meta" });
    meta.createSpan({ text: `第 ${sentenceIndex + 1} 句` });
    if (sentence.recordedAt) {
      meta.createSpan({
        text: new Date(sentence.recordedAt).toLocaleDateString("zh-CN")
      });
    }
    const actions = header.createDiv({ cls: "kakitori-record-card-actions" });
    const open = actions.createEl("button", {
      attr: {
        "aria-label": "返回原句",
        title: "返回原句"
      }
    });
    setIcon(open, "locate-fixed");
    open.addEventListener("click", () => {
      this.openRecordSentence(material, sentence.id);
    });
    const noteButton = actions.createEl("button", {
      cls: sentence.note.trim() ? "has-note" : "",
      attr: {
        "aria-label": sentence.note.trim() ? "编辑备注" : "添加备注",
        title: sentence.note.trim() ? "编辑备注" : "添加备注"
      }
    });
    setIcon(noteButton, "message-square");
    noteButton.addEventListener("click", () => {
      if (this.expandedRecordNoteIds.has(sentence.id)) {
        this.expandedRecordNoteIds.delete(sentence.id);
      } else {
        this.expandedRecordNoteIds.clear();
        this.expandedRecordNoteIds.add(sentence.id);
      }
      this.render();
    });
    const play = actions.createEl("button", {
      attr: {
        "aria-label": "播放听写",
        title: "播放听写"
      }
    });
    setIcon(play, "volume-2");
    play.addEventListener("click", () => {
      void this.playRecordSentence(sentence, play);
    });

    const allRevealed =
      sentence.highlights.length > 0 &&
      sentence.highlights.every((highlight) =>
        this.recordRevealedHighlightIds.has(highlight.id)
      );
    const revealAll = actions.createEl("button", {
      cls: allRevealed ? "is-active" : "",
      attr: {
        "aria-label": allRevealed ? "重新遮住" : "显示全文",
        title: allRevealed ? "重新遮住" : "显示全文"
      }
    });
    setIcon(revealAll, allRevealed ? "eye-off" : "eye");
    revealAll.addEventListener("click", () => {
      if (allRevealed) {
        for (const highlight of sentence.highlights) {
          this.recordRevealedHighlightIds.delete(highlight.id);
        }
      } else {
        for (const highlight of sentence.highlights) {
          this.recordRevealedHighlightIds.add(highlight.id);
        }
      }
      this.render();
    });

    const more = actions.createEl("button", {
      attr: {
        "aria-label": "更多操作",
        title: "更多操作"
      }
    });
    setIcon(more, "ellipsis");
    more.addEventListener("click", (event) => {
      this.openRecordMenu(event, material, sentence);
    });

    const sentenceText = this.renderSentenceText(
      card,
      sentence,
      "kakitori-record-sentence",
      false
    );
    sentenceText.addClass("has-interactive-highlights");
    for (const character of sentenceText.querySelectorAll<HTMLElement>(
      ".kakitori-sentence-character.is-highlighted"
    )) {
      const characterIndex = Number(character.dataset.characterIndex);
      const highlight = sentence.highlights.find(
        (candidate) =>
          characterIndex >= candidate.start &&
          characterIndex < candidate.end
      );
      if (!highlight) {
        continue;
      }
      const revealed = this.recordRevealedHighlightIds.has(highlight.id);
      character.classList.toggle("is-cloze", !revealed);
      character.setAttribute(
        "title",
        revealed ? "点击重新遮住" : "点击解除遮住"
      );
    }
    sentenceText.addEventListener("click", (event) => {
      const target =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>(
              "[data-character-index].is-highlighted"
            )
          : null;
      const characterIndex = Number(target?.dataset.characterIndex);
      if (!target || !Number.isInteger(characterIndex)) {
        return;
      }
      const highlight = sentence.highlights.find(
        (candidate) =>
          characterIndex >= candidate.start &&
          characterIndex < candidate.end
      );
      if (!highlight) {
        return;
      }
      if (this.recordRevealedHighlightIds.has(highlight.id)) {
        this.recordRevealedHighlightIds.delete(highlight.id);
      } else {
        this.recordRevealedHighlightIds.add(highlight.id);
      }
      this.render();
    });

    if (this.expandedRecordNoteIds.has(sentence.id)) {
      const noteEditor = card.createDiv({
        cls: "kakitori-record-note-editor"
      });
      const note = noteEditor.createEl("textarea", {
        cls: "kakitori-record-note",
        attr: {
          rows: "2",
          placeholder: "写下这句需要注意的地方（可选）"
        }
      });
      note.value = sentence.note;
      note.addEventListener("input", () => {
        sentence.note = note.value;
        this.scheduleSave(material);
      });
      const collapse = noteEditor.createEl("button", { text: "收起" });
      collapse.addEventListener("click", () => {
        this.expandedRecordNoteIds.delete(sentence.id);
        this.render();
      });
      window.setTimeout(() => note.focus());
    } else if (sentence.note.trim()) {
      const notePreview = card.createEl("button", {
        cls: "kakitori-record-note-preview"
      });
      setIcon(notePreview.createSpan(), "message-square");
      notePreview.createSpan({ text: sentence.note });
      notePreview.addEventListener("click", () => {
        this.expandedRecordNoteIds.clear();
        this.expandedRecordNoteIds.add(sentence.id);
        this.render();
      });
    }
  }

  private openRecordMenu(
    event: MouseEvent,
    material: KakitoriMaterial,
    sentence: KakitoriSentence
  ): void {
    const menu = new Menu();
    const characters = Array.from(sentence.text);
    for (const highlight of sentence.highlights) {
      const label = characters
        .slice(highlight.start, highlight.end)
        .join("");
      menu.addItem((item) => {
        item
          .setTitle(`取消高亮「${label}」`)
          .setIcon("eraser")
          .onClick(() => {
            this.removeSentenceHighlight(material, sentence, highlight.id);
          });
      });
    }
    if (sentence.highlights.length > 0) {
      menu.addSeparator();
    }
    menu.addItem((item) => {
      item
        .setTitle("删除整条记录")
        .setIcon("trash-2")
        .onClick(() => this.confirmDeleteRecord(material, sentence));
    });
    menu.showAtMouseEvent(event);
  }

  private confirmDeleteRecord(
    material: KakitoriMaterial,
    sentence: KakitoriSentence
  ): void {
    new ConfirmModal(
      this.app,
      "删除记录？",
      "这句的全部黄色高亮会被移除，句子备注仍会保留。",
      "删除",
      () => {
        sentence.highlights = [];
        sentence.recordedAt = null;
        this.expandedRecordNoteIds.delete(sentence.id);
        this.normalizeRecordMaterialFilter(material);
        void this.plugin.saveMaterial(material);
        this.render();
      }
    ).open();
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
      text: "逐句听写，支持全文顺序、仅书写易错句和随机练习。"
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
      this.markMaterialPracticed(material);
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
      this.markMaterialPracticed(material);
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
      text: "只重置位置与揭示状态，书写易错标记和笔记会保留。"
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
            ? "还没有标记书写易错句"
            : "当前卡组没有句子"
      });
      empty.createEl("p", {
        text:
          this.cardDeckMode === "difficult"
            ? "在右侧“本句”中标记书写易错句后，就能集中练习。"
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
      this.renderSentenceText(
        card,
        sentence,
        "kakitori-card-answer",
        true
      );
    } else {
      const blank = card.createDiv({ cls: "kakitori-card-blank" });
      const icon = blank.createDiv({ cls: "kakitori-card-listen-icon" });
      setIcon(icon, "headphones");
      blank.createEl("p", { text: "播放后听写，双击或按 Enter 揭示" });
    }
    card.addEventListener("dblclick", () => {
      if (window.getSelection()?.toString()) {
        return;
      }
      this.toggleCardReveal();
    });
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
      attr: { "aria-label": "播放／重听", title: "播放／重听" }
    });
    setIcon(play, "play");
    play.addEventListener("click", () => {
      void this.playSelectedSentence();
    });
    const regenerate = playback.createEl("button", {
      attr: {
        "aria-label": "重新生成音频",
        title: "绕过缓存并重新生成音频"
      }
    });
    setIcon(regenerate, "sparkles");
    regenerate.addEventListener("click", () => {
      void this.playSelectedSentence(true);
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
    shell.style.setProperty(
      "--kakitori-paper-scale",
      `${this.plugin.kakitoriSettings.paperSizeScale}`
    );
    shell.style.setProperty(
      "--kakitori-font-scale",
      `${this.plugin.kakitoriSettings.paperFontScale}`
    );
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
      const sentence = material.sentences.find(
        (item) => item.id === character.sentenceId
      );
      const isRevealed = this.revealedSentenceIds.has(character.sentenceId);
      const cell = paper.createSpan({
        cls: [
          "kakitori-paper-character",
          isRevealed ? "is-selectable" : "",
          sentence &&
          this.isCharacterHighlighted(
            sentence,
            character.sentenceCharacterIndex
          )
            ? "is-highlighted"
            : ""
        ]
          .filter(Boolean)
          .join(" "),
        text: character.character
      });
      cell.dataset.sentenceId = character.sentenceId;
      cell.dataset.characterIndex = `${character.sentenceCharacterIndex}`;
      cell.style.gridColumn = `${character.column + 1}`;
      cell.style.gridRow = `${character.row + 1}`;
      if (isRevealed) {
        cell.addEventListener("mouseenter", () => {
          this.clearHideControlsTimer();
          if (!this.pinnedSentenceId) {
            this.showFloatingControls(character.sentenceId, material);
          }
        });
        cell.addEventListener("mouseleave", () => {
          this.scheduleHideControls();
        });
        cell.addEventListener("click", (event) => {
          event.stopPropagation();
          if (event.detail > 1) {
            return;
          }
          this.selectAndPinSentence(character.sentenceId, material);
        });
        cell.addEventListener("dblclick", (event) => {
          event.stopPropagation();
          if (window.getSelection()?.toString()) {
            return;
          }
          this.toggleSentenceReveal(character.sentenceId);
        });
      }
    }
    paper.addEventListener("mouseup", (event) => {
      this.handleTextSelection(event, material);
    });

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
    this.applyPendingFocus();
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
      { id: "highlights", label: "高亮记录" },
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
    if (this.notesTab === "highlights") {
      if (sentence.highlights.length === 0) {
        body.createEl("p", {
          cls: "kakitori-muted",
          text: "揭示句子后选中文字，再点击“高亮并记录”。"
        });
        return;
      }
      this.renderSentenceText(
        body,
        sentence,
        "kakitori-revealed-text",
        false
      );
      this.renderHighlightChips(body, material, sentence);
      const openRecords = body.createEl("button", { text: "打开全部记录" });
      openRecords.addEventListener("click", () => this.openRecords());
      return;
    }
    const isRevealed = this.revealedSentenceIds.has(sentence.id);
    body.createDiv({
      cls: `kakitori-sentence-status ${isRevealed ? "is-revealed" : ""}`,
      text: isRevealed ? "已揭示" : "待核对"
    });
    if (isRevealed) {
      this.renderSentenceText(
        body,
        sentence,
        "kakitori-revealed-text",
        true
      );
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
    difficultLabel.createSpan({ text: "标记为书写易错句" });
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

  private renderSentenceText(
    container: HTMLElement,
    sentence: KakitoriSentence,
    className: string,
    selectable: boolean
  ): HTMLElement {
    const text = container.createDiv({ cls: className });
    text.dataset.sentenceId = sentence.id;
    for (const [index, character] of Array.from(sentence.text).entries()) {
      const span = text.createSpan({
        cls: [
          "kakitori-sentence-character",
          this.isCharacterHighlighted(sentence, index)
            ? "is-highlighted"
            : ""
        ]
          .filter(Boolean)
          .join(" "),
        text: character
      });
      span.dataset.sentenceId = sentence.id;
      span.dataset.characterIndex = `${index}`;
    }
    if (selectable && this.activeMaterial) {
      text.addClass("is-selectable");
      text.addEventListener("mouseup", (event) => {
        if (this.activeMaterial) {
          this.handleTextSelection(event, this.activeMaterial);
        }
      });
    }
    return text;
  }

  private renderHighlightChips(
    container: HTMLElement,
    material: KakitoriMaterial,
    sentence: KakitoriSentence
  ): void {
    const characters = Array.from(sentence.text);
    const list = container.createDiv({ cls: "kakitori-highlight-list" });
    for (const highlight of sentence.highlights) {
      const chip = list.createDiv({ cls: "kakitori-highlight-chip" });
      chip.createSpan({
        text: characters.slice(highlight.start, highlight.end).join("")
      });
      const remove = chip.createEl("button", {
        attr: {
          "aria-label": "取消这段高亮",
          title: "取消这段高亮"
        }
      });
      setIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.removeSentenceHighlight(material, sentence, highlight.id);
      });
    }
  }

  private removeSentenceHighlight(
    material: KakitoriMaterial,
    sentence: KakitoriSentence,
    highlightId: string
  ): void {
    sentence.highlights = sentence.highlights.filter(
      (candidate) => candidate.id !== highlightId
    );
    if (sentence.highlights.length === 0) {
      sentence.recordedAt = null;
      this.expandedRecordNoteIds.delete(sentence.id);
    }
    this.normalizeRecordMaterialFilter(material);
    void this.plugin.saveMaterial(material);
    this.render();
  }

  private normalizeRecordMaterialFilter(material: KakitoriMaterial): void {
    if (
      this.recordMaterialId === material.id &&
      !material.sentences.some(
        (candidate) => candidate.highlights.length > 0
      )
    ) {
      this.recordMaterialId = null;
    }
  }

  private isCharacterHighlighted(
    sentence: KakitoriSentence,
    characterIndex: number
  ): boolean {
    return sentence.highlights.some(
      (highlight) =>
        characterIndex >= highlight.start &&
        characterIndex < highlight.end
    );
  }

  private handleTextSelection(
    event: MouseEvent,
    material: KakitoriMaterial
  ): void {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    const startElement = this.getSelectionCharacter(range.startContainer);
    const endElement = this.getSelectionCharacter(range.endContainer);
    const sentenceId = startElement?.dataset.sentenceId;
    if (
      !startElement ||
      !endElement ||
      !sentenceId ||
      endElement.dataset.sentenceId !== sentenceId
    ) {
      return;
    }
    const sentence = material.sentences.find(
      (candidate) => candidate.id === sentenceId
    );
    if (!sentence || !this.revealedSentenceIds.has(sentenceId)) {
      return;
    }
    const startIndex = Number(startElement.dataset.characterIndex);
    const endIndex = Number(endElement.dataset.characterIndex);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
      return;
    }
    const start = startIndex + (range.startOffset > 0 ? 1 : 0);
    const end = endIndex + (range.endOffset > 0 ? 1 : 0);
    if (end <= start || !selection.toString().trim()) {
      return;
    }
    const rect = range.getBoundingClientRect();
    this.showSelectionPopover(
      material,
      sentence,
      start,
      end,
      rect.width > 0
        ? rect
        : new DOMRect(event.clientX, event.clientY, 1, 1)
    );
  }

  private getSelectionCharacter(node: Node): HTMLElement | null {
    const element =
      node instanceof HTMLElement ? node : node.parentElement;
    return (
      element?.closest<HTMLElement>(
        "[data-sentence-id][data-character-index]"
      ) ?? null
    );
  }

  private showSelectionPopover(
    material: KakitoriMaterial,
    sentence: KakitoriSentence,
    start: number,
    end: number,
    rect: DOMRect
  ): void {
    this.removeSelectionPopover();
    const popover = document.createElement("div");
    popover.className = "kakitori-selection-popover";
    const button = document.createElement("button");
    button.textContent = "高亮并记录";
    popover.appendChild(button);
    document.body.appendChild(popover);
    this.selectionPopoverEl = popover;

    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - popover.offsetWidth - 8
    );
    const preferredTop = rect.bottom + 8;
    const top =
      preferredTop + popover.offsetHeight <= window.innerHeight - 8
        ? preferredTop
        : rect.top - popover.offsetHeight - 8;
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(8, top)}px`;

    button.addEventListener("click", () => {
      const alreadyExists = sentence.highlights.some(
        (highlight) =>
          highlight.start === start && highlight.end === end
      );
      if (!alreadyExists) {
        sentence.highlights.push({
          id: crypto.randomUUID(),
          start,
          end
        });
        sentence.recordedAt ??= new Date().toISOString();
        void this.plugin.saveMaterial(material);
      }
      window.getSelection()?.removeAllRanges();
      this.removeSelectionPopover();
      this.render();
    });
  }

  private removeSelectionPopover(): void {
    this.selectionPopoverEl?.remove();
    this.selectionPopoverEl = null;
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
      { id: "difficult", label: "仅书写易错" },
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

    this.createControlButton(controls, "播放／重听", "play", () => {
      void this.playSelectedSentence();
    });
    this.createControlButton(
      controls,
      "重新生成音频",
      "sparkles",
      () => {
        void this.playSelectedSentence(true);
      }
    );
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

  private applyPendingFocus(): void {
    const sentenceId = this.pendingFocusSentenceId;
    this.pendingFocusSentenceId = null;
    if (!sentenceId || !this.paperEl) {
      return;
    }
    const regions = Array.from(
      this.paperEl.querySelectorAll<HTMLElement>(
        `.kakitori-sentence-region[data-sentence-id="${sentenceId}"]`
      )
    );
    if (regions.length === 0) {
      return;
    }
    regions[0].scrollIntoView({ block: "center", behavior: "smooth" });
    for (const region of regions) {
      region.classList.remove("is-focus-flash");
      void region.offsetWidth;
      region.classList.add("is-focus-flash");
      window.setTimeout(() => {
        region.classList.remove("is-focus-flash");
      }, 1400);
    }
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

  private openMaterial(material: KakitoriMaterial): void {
    this.activeMaterial = material;
    this.screen = "home";
    this.render();
  }

  private openMaterialMenu(
    event: MouseEvent,
    material: KakitoriMaterial
  ): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle("重命名")
        .setIcon("pencil")
        .onClick(() => this.openRenameMaterialModal(material));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item
        .setTitle("删除素材")
        .setIcon("trash-2")
        .onClick(() => this.confirmDeleteMaterial(material));
    });
    menu.showAtMouseEvent(event);
  }

  private openRenameMaterialModal(material: KakitoriMaterial): void {
    new RenameMaterialModal(
      this.app,
      material.title,
      async (title) => {
        await this.plugin.renameMaterial(material, title);
        this.render();
      }
    ).open();
  }

  private confirmDeleteMaterial(material: KakitoriMaterial): void {
    new ConfirmModal(
      this.app,
      "删除素材？",
      `「${material.title}」的练习进度、笔记和高亮记录也会一并删除。此操作无法撤销。`,
      "删除",
      () => {
        void this.deleteMaterial(material);
      }
    ).open();
  }

  private async deleteMaterial(material: KakitoriMaterial): Promise<void> {
    await this.plugin.deleteMaterial(material);
    this.materials = this.materials.filter(
      (candidate) => candidate.id !== material.id
    );
    if (this.activeMaterial?.id === material.id) {
      this.activeMaterial = null;
      this.screen = "library";
    }
    this.render();
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

  private openRecords(): void {
    this.plugin.tts.stop();
    if (this.activeMaterial) {
      void this.plugin.saveMaterial(this.activeMaterial);
    }
    this.screen = "records";
    this.activeMaterial = null;
    this.revealedSentenceIds.clear();
    this.cardSequenceIds = [];
    this.cardRevealed = false;
    this.selectedSentenceId = null;
    this.pinnedSentenceId = null;
    this.render();
  }

  private openRecordSentence(
    material: KakitoriMaterial,
    sentenceId: string
  ): void {
    this.plugin.tts.stop();
    this.activeMaterial = material;
    this.currentPage = this.findSentencePage(material, sentenceId);
    material.lastPaperPage = this.currentPage;
    this.screen = "paper";
    this.cardSequenceIds = [];
    this.cardRevealed = false;
    this.revealedSentenceIds.clear();
    this.selectedSentenceId = sentenceId;
    this.pinnedSentenceId = sentenceId;
    this.pendingFocusSentenceId = sentenceId;
    this.notesTab = "highlights";
    void this.plugin.saveMaterial(material);
    this.render();
  }

  private findSentencePage(
    material: KakitoriMaterial,
    sentenceId: string
  ): number {
    const pageCount = getPaperPageCount(material.sentences);
    for (let page = 0; page < pageCount; page += 1) {
      const layout = buildPaperPageLayout(
        material.sentences,
        page,
        material.direction
      );
      if (
        layout.characters.some(
          (character) => character.sentenceId === sentenceId
        )
      ) {
        return page;
      }
    }
    return 0;
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
    this.markMaterialPracticed(material);
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
    this.markMaterialPracticed(material);
    this.screen = "card";
    this.render();
  }

  private markMaterialPracticed(material: KakitoriMaterial): void {
    material.lastPracticedAt = new Date().toISOString();
    void this.plugin.saveMaterial(material);
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

  private async playSelectedSentence(
    forceRegenerate = false
  ): Promise<void> {
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
        this.playbackSpeed,
        forceRegenerate
      );
      if (forceRegenerate) {
        new Notice("当前句音频已重新生成。");
      }
    } catch {
      new Notice("语音播放失败，请检查 Azure 区域、密钥和网络。");
    }
  }

  private async playRecordSentence(
    sentence: KakitoriSentence,
    button: HTMLButtonElement
  ): Promise<void> {
    const config = this.getAzureSpeechConfig();
    if (!config) {
      new Notice("请先在 Kakitori 设置中填写 Azure 区域与 Speech 密钥。");
      return;
    }
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    button.addClass("is-loading");
    try {
      await this.plugin.tts.play(
        sentence.text,
        config,
        this.playbackSpeed
      );
    } catch {
      new Notice("播放失败，请检查 Azure 密钥与网络连接。");
    } finally {
      button.disabled = false;
      button.removeClass("is-loading");
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

  private scheduleSave(
    material: KakitoriMaterial | null = this.activeMaterial
  ): void {
    if (!material) {
      return;
    }
    const existingTimer = this.saveTimers.get(material.id);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      this.saveTimers.delete(material.id);
      void this.plugin.saveMaterial(material);
    }, 350);
    this.saveTimers.set(material.id, timer);
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
