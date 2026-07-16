/**
 * 书摘记录管理助手 —— 前端逻辑
 * 数据全部存储于浏览器 localStorage，无需后端服务
 */

(function () {
  'use strict';

  /* ============ 常量与工具 ============ */

  const STORAGE_KEY = 'bookNotes.entries.v1';

  const TYPE_LABEL = { excerpt: '摘抄', thought: '感想' };

  const WEEKDAY_LABEL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  /** 生成唯一 ID */
  function generateId() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /** 两位数补零 */
  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** 取本地日期 key（YYYY-MM-DD），避免时区导致跨天错乱 */
  function dateKeyOf(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function timeOf(date) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function isSameDay(a, b) {
    return dateKeyOf(a) === dateKeyOf(b);
  }

  /** 格式化分组日期标题，如 "今天 · 7月6日 星期一" */
  function formatDayHeading(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    let prefix = '';
    if (isSameDay(date, now)) prefix = '今天';
    else if (isSameDay(date, yesterday)) prefix = '昨天';

    const yearPart = y === now.getFullYear() ? '' : `${y}年`;
    const mainText = `${yearPart}${m}月${d}日`;
    const weekday = WEEKDAY_LABEL[date.getDay()];

    return { main: prefix || mainText, sub: prefix ? `${mainText} ${weekday}` : weekday };
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ============ 数据层 ============ */

  const Store = {
    _entries: null,

    load() {
      if (this._entries) return this._entries;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        this._entries = raw ? JSON.parse(raw) : [];
      } catch (err) {
        console.error('读取本地数据失败，已重置为空列表', err);
        this._entries = [];
      }
      return this._entries;
    },

    persist() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._entries));
    },

    all() {
      return this.load().slice();
    },

    add(content, type) {
      const now = new Date();
      const entry = {
        id: generateId(),
        content,
        type,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      this.load().unshift(entry);
      this.persist();
      return entry;
    },

    update(id, patch) {
      const list = this.load();
      const idx = list.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
      this.persist();
      return list[idx];
    },

    remove(id) {
      const list = this.load();
      const idx = list.findIndex((e) => e.id === id);
      if (idx === -1) return false;
      list.splice(idx, 1);
      this.persist();
      return true;
    },

    stats() {
      const list = this.load();
      const days = new Set(list.map((e) => dateKeyOf(new Date(e.createdAt))));
      const excerpt = list.filter((e) => e.type === 'excerpt').length;
      const thought = list.filter((e) => e.type === 'thought').length;
      return { days: days.size, total: list.length, excerpt, thought };
    },
  };

  /* ============ 应用状态 ============ */

  const state = {
    currentView: 'home',
    composerType: 'excerpt',
    overviewMode: 'time',
    editingId: null,
  };

  /* ============ DOM 引用 ============ */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    views: $$('.view'),
    tabItems: $$('.tab-item'),

    homeDate: $('#homeDate'),
    typeToggle: $('.composer .type-toggle'),
    contentInput: $('#contentInput'),
    charCount: $('#charCount'),
    saveBtn: $('#saveBtn'),
    toast: $('#toast'),

    statDays: $('#statDays'),
    statTotal: $('#statTotal'),
    statExcerpt: $('#statExcerpt'),
    statThought: $('#statThought'),
    exportBtn: $('#exportBtn'),
    exportMenu: $('#exportMenu'),
    exportDropdown: $('#exportDropdown'),
    modeSwitch: $('.mode-switch'),
    entryList: $('#entryList'),
    emptyState: $('#emptyState'),

    sheetOverlay: $('#sheetOverlay'),
    sheet: $('#sheet'),
    editTypeToggle: $('.sheet .type-toggle'),
    editInput: $('#editInput'),
    editMeta: $('#editMeta'),
    deleteBtn: $('#deleteBtn'),
    cancelBtn: $('#cancelBtn'),
    updateBtn: $('#updateBtn'),
  };

  /* ============ 视图切换 ============ */

  function switchView(target) {
    state.currentView = target;
    els.views.forEach((v) => {
      v.hidden = v.dataset.view !== target;
    });
    els.tabItems.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.target === target);
    });
    if (target === 'overview') renderOverview();
  }

  els.tabItems.forEach((btn) => {
    btn.addEventListener('click', () => switchView(btn.dataset.target));
  });

  /* ============ 首页：记录 ============ */

  function renderHomeDate() {
    const now = new Date();
    els.homeDate.textContent = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEKDAY_LABEL[now.getDay()]}`;
  }

  els.typeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.type-pill');
    if (!btn) return;
    state.composerType = btn.dataset.type;
    $$('.type-pill', els.typeToggle).forEach((p) => {
      const active = p === btn;
      p.classList.toggle('is-active', active);
      p.setAttribute('aria-selected', String(active));
    });
  });

  function updateComposerState() {
    const len = els.contentInput.value.length;
    els.charCount.textContent = `${len} / 2000`;
    els.saveBtn.disabled = len === 0;
  }

  els.contentInput.addEventListener('input', updateComposerState);

  let toastTimer = null;
  function showToast(text) {
    els.toast.textContent = text;
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 1600);
  }

  els.saveBtn.addEventListener('click', () => {
    const content = els.contentInput.value.trim();
    if (!content) return;
    Store.add(content, state.composerType);
    els.contentInput.value = '';
    updateComposerState();
    showToast('已记录');
  });

  /* ============ 总览页：统计 ============ */

  function renderStats() {
    const s = Store.stats();
    els.statDays.textContent = s.days;
    els.statTotal.textContent = s.total;
    els.statExcerpt.textContent = s.excerpt;
    els.statThought.textContent = s.thought;
    els.exportBtn.disabled = s.total === 0;
    if (s.total === 0) closeExportMenu();
  }

  els.modeSwitch.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-pill');
    if (!btn) return;
    state.overviewMode = btn.dataset.mode;
    $$('.mode-pill', els.modeSwitch).forEach((p) => {
      const active = p === btn;
      p.classList.toggle('is-active', active);
      p.setAttribute('aria-selected', String(active));
    });
    renderEntryList();
  });

  /* ============ 总览页：导出（CSV / Markdown） ============ */

  /** CSV 字段转义：包含逗号/引号/换行时需要用双引号包裹，内部双引号转义为两个双引号 */
  function csvEscape(value) {
    const str = String(value ?? '');
    if (/[",\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  /** 生成 CSV 文本：日期采用 MM/DD/YYYY，便于导入 Notion 等工具时被识别为日期属性 */
  function buildCsv(list) {
    const header = ['内容', '分类', '日期', '时间', 'ID'];
    const sorted = list.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const rows = sorted.map((entry) => {
      const date = new Date(entry.createdAt);
      const dateStr = `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}/${date.getFullYear()}`;
      return [entry.content, TYPE_LABEL[entry.type], dateStr, timeOf(date), entry.id]
        .map(csvEscape)
        .join(',');
    });

    return [header.join(','), ...rows].join('\r\n');
  }

  /** 生成 Obsidian 友好的 Markdown：YAML frontmatter + 按日期分组，摘抄用引用块 */
  function buildMarkdown(list) {
    const now = new Date();
    const sorted = list.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const groups = new Map();

    sorted.forEach((entry) => {
      const key = dateKeyOf(new Date(entry.createdAt));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });

    const lines = [
      '---',
      'title: 书摘记录',
      `exported: ${dateKeyOf(now)}`,
      'source: 书摘助手',
      'tags:',
      '  - 书摘',
      '---',
      '',
      '# 书摘记录',
      '',
      `共 ${list.length} 条 · 导出于 ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`,
      '',
    ];

    Array.from(groups.keys()).forEach((key) => {
      const [y, m, d] = key.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      lines.push(`## ${key} · ${WEEKDAY_LABEL[date.getDay()]}`);
      lines.push('');

      groups.get(key).forEach((entry) => {
        const created = new Date(entry.createdAt);
        const label = TYPE_LABEL[entry.type];
        lines.push(`### ${label} · ${timeOf(created)}`);
        lines.push('');
        if (entry.type === 'excerpt') {
          // 摘抄用引用块，更符合 Obsidian 阅读习惯
          entry.content.split(/\r?\n/).forEach((line) => {
            lines.push(`> ${line}`);
          });
        } else {
          lines.push(entry.content);
        }
        lines.push('');
        lines.push(`^${entry.id}`);
        lines.push('');
      });
    });

    return lines.join('\n').trim() + '\n';
  }

  /** 关闭导出下拉菜单 */
  function closeExportMenu() {
    els.exportDropdown.hidden = true;
    els.exportBtn.setAttribute('aria-expanded', 'false');
  }

  /** 打开/关闭导出下拉菜单 */
  function toggleExportMenu() {
    if (els.exportBtn.disabled) return;
    const willOpen = els.exportDropdown.hidden;
    els.exportDropdown.hidden = !willOpen;
    els.exportBtn.setAttribute('aria-expanded', String(willOpen));
  }

  /**
   * 通用导出：优先走系统分享面板，失败则触发浏览器下载
   * @param {string} filename 文件名
   * @param {string} content 文件内容
   * @param {string} mimeType MIME 类型
   */
  async function shareOrDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });

    if (navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          showToast('已导出');
          return;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return; // 用户主动取消分享，不再兜底下载
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('已导出');
  }

  async function exportAs(format) {
    const list = Store.all();
    if (list.length === 0) return;

    const stamp = dateKeyOf(new Date());
    closeExportMenu();

    if (format === 'csv') {
      await shareOrDownload(
        `书摘导出_${stamp}.csv`,
        '\uFEFF' + buildCsv(list), // 加 BOM，避免 Excel 等工具打开时中文乱码
        'text/csv;charset=utf-8;'
      );
      return;
    }

    if (format === 'markdown') {
      await shareOrDownload(
        `书摘导出_${stamp}.md`,
        buildMarkdown(list),
        'text/markdown;charset=utf-8;'
      );
    }
  }

  els.exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExportMenu();
  });

  els.exportDropdown.addEventListener('click', (e) => {
    const option = e.target.closest('.export-option');
    if (!option) return;
    exportAs(option.dataset.format);
  });

  // 点击页面其他区域时关闭下拉菜单
  document.addEventListener('click', (e) => {
    if (!els.exportMenu.contains(e.target)) closeExportMenu();
  });

  /* ============ 总览页：列表渲染 ============ */

  function entryCardHtml(entry) {
    const date = new Date(entry.createdAt);
    return `
      <article class="entry-card" data-id="${entry.id}">
        <div class="entry-card-top">
          <span class="entry-tag ${entry.type}">${TYPE_LABEL[entry.type]}</span>
          <span class="entry-time">${timeOf(date)}</span>
        </div>
        <p class="entry-content">${escapeHtml(entry.content)}</p>
      </article>
    `;
  }

  function renderByTime(list) {
    const groups = new Map(); // dateKey -> entries[]
    list.forEach((entry) => {
      const key = dateKeyOf(new Date(entry.createdAt));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });

    const sortedKeys = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1));

    return sortedKeys
      .map((key) => {
        const heading = formatDayHeading(key);
        const cards = groups.get(key).map(entryCardHtml).join('');
        return `
          <div class="day-group">
            <div class="group-heading">
              <span class="group-heading-main">${heading.main}</span>
              <span class="group-heading-sub">${heading.sub}</span>
            </div>
            ${cards}
          </div>
        `;
      })
      .join('');
  }

  function renderByType(list) {
    const types = ['excerpt', 'thought'];
    return types
      .map((type) => {
        const items = list.filter((e) => e.type === type);
        if (items.length === 0) return '';
        const cards = items.map(entryCardHtml).join('');
        return `
          <div class="type-group">
            <div class="type-section-title ${type}">
              <span class="tag-dot"></span>
              <span>${TYPE_LABEL[type]}</span>
              <span class="type-section-count">${items.length} 条</span>
            </div>
            ${cards}
          </div>
        `;
      })
      .join('');
  }

  function renderEntryList() {
    const list = Store.all().sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    if (list.length === 0) {
      els.entryList.innerHTML = '';
      els.emptyState.hidden = false;
      return;
    }
    els.emptyState.hidden = true;

    els.entryList.innerHTML =
      state.overviewMode === 'time' ? renderByTime(list) : renderByType(list);
  }

  function renderOverview() {
    renderStats();
    renderEntryList();
  }

  els.entryList.addEventListener('click', (e) => {
    const card = e.target.closest('.entry-card');
    if (!card) return;
    openEditSheet(card.dataset.id);
  });

  /* ============ 编辑弹层 ============ */

  function openEditSheet(id) {
    const entry = Store.all().find((e) => e.id === id);
    if (!entry) return;
    state.editingId = id;

    els.editInput.value = entry.content;
    $$('.type-pill', els.editTypeToggle).forEach((p) => {
      const active = p.dataset.editType === entry.type;
      p.classList.toggle('is-active', active);
      p.setAttribute('aria-selected', String(active));
    });

    const created = new Date(entry.createdAt);
    els.editMeta.textContent = `记录于 ${created.getFullYear()}年${created.getMonth() + 1}月${created.getDate()}日 ${timeOf(created)}`;

    els.sheetOverlay.hidden = false;
    requestAnimationFrame(() => els.sheetOverlay.classList.add('is-visible'));
  }

  function closeEditSheet() {
    els.sheetOverlay.classList.remove('is-visible');
    setTimeout(() => {
      els.sheetOverlay.hidden = true;
      state.editingId = null;
    }, 280);
  }

  els.editTypeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.type-pill');
    if (!btn) return;
    $$('.type-pill', els.editTypeToggle).forEach((p) => {
      const active = p === btn;
      p.classList.toggle('is-active', active);
      p.setAttribute('aria-selected', String(active));
    });
  });

  els.cancelBtn.addEventListener('click', closeEditSheet);
  els.sheetOverlay.addEventListener('click', (e) => {
    if (e.target === els.sheetOverlay) closeEditSheet();
  });

  els.updateBtn.addEventListener('click', () => {
    if (!state.editingId) return;
    const content = els.editInput.value.trim();
    if (!content) return;
    const activePill = $('.type-pill.is-active', els.editTypeToggle);
    const type = activePill ? activePill.dataset.editType : 'excerpt';
    Store.update(state.editingId, { content, type });
    closeEditSheet();
    renderOverview();
    showToast('已保存');
  });

  els.deleteBtn.addEventListener('click', () => {
    if (!state.editingId) return;
    Store.remove(state.editingId);
    closeEditSheet();
    renderOverview();
    showToast('已删除');
  });

  /* ============ 初始化 ============ */

  function init() {
    renderHomeDate();
    updateComposerState();
    switchView('home');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
