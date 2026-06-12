import Fuse from "fuse.js";
import "./style.css";

const STATUS_META = {
  active: { icon: "🔥", label: "活跃", cls: "st-active" },
  normal: { icon: "✅", label: "正常", cls: "st-normal" },
  stale: { icon: "⚠️", label: "停更", cls: "st-stale" },
  archived: { icon: "❌", label: "已归档", cls: "st-archived" },
  unknown: { icon: "·", label: "未知", cls: "st-unknown" },
};

const state = {
  all: [],
  tags: [],
  licenses: {},
  tr: {},          // 英文 -> 中文 翻译表
  lang: "zh",      // zh | en 显示语言
  fuse: null,
  query: "",
  activeCategories: new Set(),
  activePlatforms: new Set(),
  activeLicenses: new Set(),
  hideArchived: true,
  dockerOnly: false,
  sort: "health",
};

const $ = (id) => document.getElementById(id);

// 取译文:中文模式且有缓存则返回中文,否则回退英文原文
function t(text) {
  if (state.lang === "zh" && state.tr[text]) return state.tr[text];
  return text;
}

async function load() {
  const base = import.meta.env.BASE_URL;
  const [dataRes, trRes] = await Promise.all([
    fetch(`${base}data.json`),
    fetch(`${base}translations.json`).catch(() => null),
  ]);
  const data = await dataRes.json();
  state.all = data.software;
  state.tags = data.tags;
  state.licenses = data.licenses;
  if (trRes && trRes.ok) {
    try {
      state.tr = await trRes.json();
    } catch {
      state.tr = {};
    }
  }
  state.fuse = new Fuse(state.all, {
    keys: ["name", "description", "tags"],
    threshold: 0.38,
    ignoreLocation: true,
  });
  buildFacets();
  bindEvents();
  $("stats").textContent = `${state.all.length} 个开源自托管软件`;
  render();
}

// 统计每个分面值的出现次数,降序取前 N
function countBy(items, getter) {
  const map = new Map();
  for (const it of items) {
    for (const v of getter(it)) {
      map.set(v, (map.get(v) || 0) + 1);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function buildFacets() {
  const cats = countBy(state.all, (s) => s.tags);
  renderFacet($("categories"), cats, state.activeCategories, "cat", true);

  const plats = countBy(state.all, (s) => s.platforms).slice(0, 30);
  renderFacet($("platforms"), plats, state.activePlatforms, "plat", false);

  const lics = countBy(state.all, (s) => s.licenses).slice(0, 20);
  renderFacet($("licenses"), lics, state.activeLicenses, "lic", false);
}

// translate=true 时分面名显示中文译名,但筛选值仍用英文原文
function renderFacet(container, entries, activeSet, kind, translate) {
  container.innerHTML = "";
  for (const [value, count] of entries) {
    const item = document.createElement("label");
    item.className = "facet-item";
    item.dataset.value = value;
    const display = translate ? t(value) : value;
    item.innerHTML = `<input type="checkbox" data-kind="${kind}" />
      <span class="facet-name" title="${escapeHtml(value)}">${escapeHtml(display)}</span>
      <span class="facet-count">${count}</span>`;
    item.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) activeSet.add(value);
      else activeSet.delete(value);
      render();
    });
    container.appendChild(item);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function bindEvents() {
  let timer;
  $("search").addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value.trim();
      render();
    }, 150);
  });
  $("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });
  $("hideArchived").addEventListener("change", (e) => {
    state.hideArchived = e.target.checked;
    render();
  });
  $("dockerOnly").addEventListener("change", (e) => {
    state.dockerOnly = e.target.checked;
    render();
  });
  $("langToggle").addEventListener("click", () => {
    state.lang = state.lang === "zh" ? "en" : "zh";
    $("langToggle").classList.toggle("en", state.lang === "en");
    buildFacets();  // 分类名随语言切换
    render();
  });
  $("catFilter").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    for (const el of $("categories").children) {
      const name = el.dataset.value.toLowerCase();
      el.style.display = name.includes(q) ? "" : "none";
    }
  });
}

function applyFilters() {
  // 搜索:有 query 走 Fuse,否则全量
  let list = state.query
    ? state.fuse.search(state.query).map((r) => r.item)
    : state.all.slice();

  list = list.filter((s) => {
    if (state.hideArchived && (s.status === "archived" || s.status === "stale")) return false;
    if (state.dockerOnly && !s.has_docker) return false;
    if (state.activeCategories.size && !s.tags.some((t) => state.activeCategories.has(t))) return false;
    if (state.activePlatforms.size && !s.platforms.some((p) => state.activePlatforms.has(p))) return false;
    if (state.activeLicenses.size && !s.licenses.some((l) => state.activeLicenses.has(l))) return false;
    return true;
  });

  // 排序(搜索态默认保留相关度,除非用户显式选了排序字段)
  if (!(state.query && state.sort === "health")) {
    list = sortList(list);
  }
  return list;
}

function sortList(list) {
  const by = {
    health: (a, b) => (b.health_score ?? -1) - (a.health_score ?? -1),
    stars: (a, b) => b.stars - a.stars,
    updated: (a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return list.sort(by[state.sort] || by.health);
}

function render() {
  const list = applyFilters();
  const grid = $("grid");
  $("resultBar").textContent = `共 ${list.length} 个结果`;
  $("empty").hidden = list.length > 0;

  // 限制首屏渲染数量,避免一次性插入上千 DOM
  const slice = list.slice(0, 300);
  grid.innerHTML = slice.map(cardHtml).join("");
  if (list.length > 300) {
    grid.insertAdjacentHTML(
      "beforeend",
      `<div class="more-note">仅显示前 300 个,缩小筛选范围查看更多</div>`
    );
  }
}

function cardHtml(s) {
  const st = STATUS_META[s.status] || STATUS_META.unknown;
  const score = s.health_score == null ? "—" : s.health_score;
  const tags = s.platforms.slice(0, 3).map((p) => `<span class="tag">${escapeHtml(p)}</span>`).join("");
  const lic = s.licenses[0] ? `<span class="tag lic">${escapeHtml(s.licenses[0])}</span>` : "";
  const stars = s.stars ? `★ ${formatNum(s.stars)}` : "";
  const links = [
    s.website_url && `<a href="${escapeHtml(s.website_url)}" target="_blank" rel="noopener">官网</a>`,
    s.source_code_url && `<a href="${escapeHtml(s.source_code_url)}" target="_blank" rel="noopener">源码</a>`,
    s.demo_url && `<a href="${escapeHtml(s.demo_url)}" target="_blank" rel="noopener">演示</a>`,
  ].filter(Boolean).join("");

  return `<article class="card ${st.cls}">
    <div class="card-head">
      <h3 class="card-name">${escapeHtml(s.name)}</h3>
      <span class="status" title="健康分 ${score}">${st.icon} ${score}</span>
    </div>
    <p class="card-desc">${escapeHtml(t(s.description))}</p>
    <div class="card-tags">${lic}${tags}</div>
    <div class="card-foot">
      <span class="stars">${stars}</span>
      <span class="links">${links}</span>
    </div>
  </article>`;
}

function formatNum(n) {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
}

load();

