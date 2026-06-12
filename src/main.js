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
  view: "all", // all | trending_1d | trending_7d | stars
};

// 榜单视图 -> 对应排序键 + 涨幅字段(用于徽章)
const RANK_VIEWS = {
  trending_1d: { sort: "trending_1d", delta: "stars_delta_1d", label: "今日涨星榜" },
  trending_7d: { sort: "trending_7d", delta: "stars_delta_7d", label: "7 日涨星榜" },
  stars: { sort: "stars", delta: null, label: "Star 总榜" },
};
const RANK_LIMIT = 100;

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
  $("views").addEventListener("click", (e) => {
    const btn = e.target.closest(".view-tab");
    if (!btn) return;
    state.view = btn.dataset.view;
    for (const b of $("views").children) {
      b.classList.toggle("active", b === btn);
    }
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
  const rank = RANK_VIEWS[state.view];

  // 榜单视图:不走侧栏筛选,只按榜单字段排序取 Top N
  if (rank) {
    let list = state.all.slice();
    // 涨星榜只保留有正涨幅的项目
    if (rank.delta) {
      list = list.filter((s) => (s[rank.delta] ?? 0) > 0);
    }
    list.sort(sortBy(rank.sort));
    return list.slice(0, RANK_LIMIT);
  }

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
    list = list.sort(sortBy(state.sort));
  }
  return list;
}

function sortBy(key) {
  const by = {
    health: (a, b) => (b.health_score ?? -1) - (a.health_score ?? -1),
    stars: (a, b) => b.stars - a.stars,
    trending_1d: (a, b) => (b.stars_delta_1d ?? -1) - (a.stars_delta_1d ?? -1),
    trending_7d: (a, b) => (b.stars_delta_7d ?? -1) - (a.stars_delta_7d ?? -1),
    updated: (a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return by[key] || by.health;
}

function render() {
  const rank = RANK_VIEWS[state.view];
  document.body.classList.toggle("rank-mode", !!rank);

  const list = applyFilters();
  const grid = $("grid");
  $("empty").hidden = list.length > 0;

  if (rank) {
    $("resultBar").textContent = `${rank.label} · 共 ${list.length} 个`;
    grid.innerHTML = list.map((s, i) => cardHtml(s, i + 1, rank.delta)).join("");
    return;
  }

  $("resultBar").textContent = `共 ${list.length} 个结果`;
  // 限制首屏渲染数量,避免一次性插入上千 DOM
  const slice = list.slice(0, 300);
  grid.innerHTML = slice.map((s) => cardHtml(s)).join("");
  if (list.length > 300) {
    grid.insertAdjacentHTML(
      "beforeend",
      `<div class="more-note">仅显示前 300 个,缩小筛选范围查看更多</div>`
    );
  }
}

function cardHtml(s, position, deltaField) {
  const st = STATUS_META[s.status] || STATUS_META.unknown;
  const score = s.health_score == null ? "—" : s.health_score;
  const tags = s.platforms.slice(0, 3).map((p) => `<span class="tag">${escapeHtml(p)}</span>`).join("");
  const lic = s.licenses[0] ? `<span class="tag lic">${escapeHtml(s.licenses[0])}</span>` : "";
  const stars = s.stars ? `★ ${formatNum(s.stars)}` : "";

  // 榜单名次徽章(前三高亮)
  const rankBadge = position
    ? `<span class="rank rank-${position <= 3 ? position : "n"}">${position}</span>`
    : "";
  // 涨幅徽章:榜单指定了 delta 字段且 >0 才显示
  const dv = deltaField ? s[deltaField] : null;
  const trend = dv && dv > 0 ? `<span class="trend">+${formatNum(dv)} ↑</span>` : "";

  const links = [
    s.website_url && `<a href="${escapeHtml(s.website_url)}" target="_blank" rel="noopener">官网</a>`,
    s.source_code_url && `<a href="${escapeHtml(s.source_code_url)}" target="_blank" rel="noopener">源码</a>`,
    s.demo_url && `<a href="${escapeHtml(s.demo_url)}" target="_blank" rel="noopener">演示</a>`,
  ].filter(Boolean).join("");

  return `<article class="card ${st.cls}">
    <div class="card-head">
      <h3 class="card-name">${rankBadge}${escapeHtml(s.name)}</h3>
      <span class="status" title="健康分 ${score}">${st.icon} ${score}</span>
    </div>
    <p class="card-desc">${escapeHtml(t(s.description))}</p>
    <div class="card-tags">${lic}${tags}</div>
    <div class="card-foot">
      <span class="stars">${stars} ${trend}</span>
      <span class="links">${links}</span>
    </div>
  </article>`;
}

function formatNum(n) {
  return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n);
}

load();

