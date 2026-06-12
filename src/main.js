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
  groups: [],
  tr: {},          // 英文 -> 中文 翻译表
  lang: "zh",      // zh | en 显示语言
  fuse: null,
  query: "",
  activeSubs: new Set(),       // 选中的小类(中文名)
  activeFreshness: new Set(),  // 选中的更新时间档位
  hideArchived: true,
  dockerOnly: false,
  sort: "health",
  view: "all", // all | trending_1d | trending_7d | stars
};

// 更新时间档位:key 对应 software.freshness,顺序即展示顺序
const FRESHNESS_META = [
  { key: "recent", icon: "🟢", label: "近 1 年内" },
  { key: "y1", icon: "🟡", label: "1~2 年前" },
  { key: "y2", icon: "🟠", label: "2~3 年前" },
  { key: "old", icon: "🔴", label: "3 年以上" },
  { key: "unknown", icon: "⚪", label: "未知" },
];

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
  showSkeleton();
  const base = import.meta.env.BASE_URL;
  try {
    const [dataRes, trRes] = await Promise.all([
      fetch(`${base}data.json`),
      fetch(`${base}translations.json`).catch(() => null),
    ]);
    if (!dataRes.ok) throw new Error(`data.json ${dataRes.status}`);
    const data = await dataRes.json();
    state.all = data.software;
    state.groups = data.groups;
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
  } catch (err) {
    showError();
  }
}

// 加载占位骨架卡
function showSkeleton() {
  $("grid").innerHTML = Array.from({ length: 9 })
    .map(() => `<div class="skeleton-card"></div>`)
    .join("");
}

// 加载失败提示(可重试)
function showError() {
  $("grid").innerHTML = `<div class="error-state">
    <div class="empty-icon">⚠️</div>
    <div class="empty-title">数据加载失败</div>
    <div class="empty-sub">检查网络后 <a onclick="location.reload()">点此重试</a>。</div>
  </div>`;
}

// 构建侧栏分面:两级分类树 + 更新时间档位
function buildFacets() {
  renderCategoryTree();
  renderFreshness();
}

// 两级分类树:大类可点击展开/收起小类,小类是复选框
function renderCategoryTree() {
  const root = $("categories");
  root.innerHTML = "";
  for (const g of state.groups) {
    const block = document.createElement("div");
    block.className = "cat-group";

    const head = document.createElement("button");
    head.className = "cat-group-head";
    head.type = "button";
    head.innerHTML = `<span class="cat-arrow">▸</span>
      <span class="cat-icon">${g.icon}</span>
      <span class="cat-gname">${escapeHtml(g.name)}</span>
      <span class="facet-count">${g.count}</span>`;

    const subWrap = document.createElement("div");
    subWrap.className = "cat-subs";
    subWrap.hidden = true;
    for (const sub of g.subs) {
      const item = document.createElement("label");
      item.className = "facet-item sub-item";
      item.dataset.value = sub.name;
      item.innerHTML = `<input type="checkbox" data-kind="sub" />
        <span class="facet-name" title="${escapeHtml(sub.name)}">${escapeHtml(sub.name)}</span>
        <span class="facet-count">${sub.count}</span>`;
      item.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) state.activeSubs.add(sub.name);
        else state.activeSubs.delete(sub.name);
        render();
      });
      subWrap.appendChild(item);
    }

    head.addEventListener("click", () => {
      subWrap.hidden = !subWrap.hidden;
      head.classList.toggle("open", !subWrap.hidden);
    });

    block.appendChild(head);
    block.appendChild(subWrap);
    root.appendChild(block);
  }
}

// 更新时间档位筛选
function renderFreshness() {
  const counts = new Map();
  for (const s of state.all) {
    counts.set(s.freshness, (counts.get(s.freshness) || 0) + 1);
  }
  const root = $("freshness");
  root.innerHTML = "";
  for (const f of FRESHNESS_META) {
    const n = counts.get(f.key) || 0;
    if (n === 0) continue;
    const item = document.createElement("label");
    item.className = "facet-item";
    item.dataset.value = f.key;
    item.innerHTML = `<input type="checkbox" data-kind="fresh" />
      <span class="facet-name">${f.icon} ${escapeHtml(f.label)}</span>
      <span class="facet-count">${n}</span>`;
    item.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) state.activeFreshness.add(f.key);
      else state.activeFreshness.delete(f.key);
      render();
    });
    root.appendChild(item);
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
    render();
  });
  $("catFilter").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    for (const block of $("categories").children) {
      const head = block.querySelector(".cat-group-head");
      const subs = block.querySelector(".cat-subs");
      const gname = head.querySelector(".cat-gname").textContent.toLowerCase();
      let anyMatch = false;
      for (const el of subs.children) {
        const name = el.dataset.value.toLowerCase();
        const hit = !q || name.includes(q) || gname.includes(q);
        el.style.display = hit ? "" : "none";
        if (hit) anyMatch = true;
      }
      // 有搜索词时,大类整体按命中情况显隐并自动展开
      block.style.display = !q || anyMatch ? "" : "none";
      if (q && anyMatch) {
        subs.hidden = false;
        head.classList.add("open");
      } else if (!q) {
        subs.hidden = true;
        head.classList.remove("open");
      }
    }
  });
  $("clearFilters").addEventListener("click", clearFilters);
}

// 重置所有搜索/筛选条件,恢复全量列表
function clearFilters() {
  state.query = "";
  state.activeSubs.clear();
  state.activeFreshness.clear();
  state.hideArchived = true;
  state.dockerOnly = false;
  // 同步 UI 控件
  $("search").value = "";
  $("catFilter").value = "";
  $("hideArchived").checked = true;
  $("dockerOnly").checked = false;
  for (const facet of ["categories", "freshness"]) {
    for (const cb of $(facet).querySelectorAll("input[type=checkbox]")) {
      cb.checked = false;
    }
  }
  // 收起分类树、还原显隐
  for (const block of $("categories").children) {
    block.style.display = "";
    const subs = block.querySelector(".cat-subs");
    const head = block.querySelector(".cat-group-head");
    subs.hidden = true;
    head.classList.remove("open");
    for (const el of subs.children) el.style.display = "";
  }
  render();
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
    if (state.activeSubs.size && !state.activeSubs.has(s.sub)) return false;
    if (state.activeFreshness.size && !state.activeFreshness.has(s.freshness)) return false;
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
    s.website_url && `<a href="${escapeHtml(s.website_url)}" target="_blank" rel="noopener">🌐 官网</a>`,
    s.source_code_url && `<a href="${escapeHtml(s.source_code_url)}" target="_blank" rel="noopener">⌨ 源码</a>`,
    s.demo_url && `<a href="${escapeHtml(s.demo_url)}" target="_blank" rel="noopener">▶ 演示</a>`,
  ].filter(Boolean).join("");

  // 榜单前三名:卡片整体突出
  const top3 = position && position <= 3 ? ` card-top3 top-${position}` : "";

  return `<article class="card ${st.cls}${top3}">
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

