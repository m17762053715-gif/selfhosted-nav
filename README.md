# 自托管导航 · SelfHosted Nav

一个比官网更好用的**中文自托管开源软件导航站**。数据来自
[awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted-data),
共收录 1300+ 款可自托管的开源软件。

## 相比官网的改进

- **中文界面** —— 全部软件描述与分类名翻译为简体中文(可一键切回英文)
- **健康度排序** —— 综合 star 数、近半年提交活跃度、是否归档、最新发布,
  给每个项目算 0~100 健康分,一眼看出哪些靠谱
- **涨星榜单** —— 每日记录各项目 star 数,提供「🔥 涨星·今日」「📈 涨星·7日」
  「⭐ Star 总榜」三个 Top 100 排行榜,发现正在爆发的新项目
- **废弃预警** —— 自动标记 🔥活跃 / ✅正常 / ⚠️停更 / ❌已归档,默认隐藏废弃项目
- **多维筛选** —— 按分类 / 语言平台 / 许可证 / 是否支持 Docker 组合筛选
- **模糊搜索** —— 搜 "Notion" 命中 AFFiNE、Huly 等替代品

## 本地开发

```bash
npm install
npm run dev          # 本地预览
npm run build        # 构建到 dist/
```

## 更新数据

```bash
python scripts/fetch_data.py        # 拉取最新 awesome-selfhosted 数据
python scripts/build_dataset.py     # 解析 + 计算健康分/涨星 -> public/data.json + star_history.json
AGNES_API_KEY=xxx python scripts/translate.py   # 增量翻译新增条目
```

翻译带缓存,只翻译尚未翻过的条目,可中断续跑。

`build_dataset.py` 每次运行会把当日各项目 star 数追加到 `public/star_history.json`
(滚动保留最近 30 天),并据此算出 `stars_delta_1d` / `stars_delta_7d` 涨幅,
供前端涨星榜使用。基准日默认取系统当天,可用 `SNAPSHOT_DATE=YYYY-MM-DD` 覆盖(测试用)。

### 涨星榜冷启动(一次性)

首次部署时星历史为空,涨星榜无数据。运行回填脚本,从上游 git 历史
取过去若干天的 star 快照,让站点上线即有榜单:

```bash
python scripts/bootstrap_history.py --days 14
```

## 自动更新(每日)

`.github/workflows/update.yml` 是一份每日定时工作流(UTC 02:20),自动完成:
拉取最新数据 → 算健康分/涨星 → 翻译 → 提交数据回 `main` → 构建并部署到 GitHub Pages。

线上地址:https://m17762053715-gif.github.io/selfhosted-nav/

启用前置条件:

1. **推送 workflow 需要权限**:本机执行一次 `gh auth refresh -s workflow`,
   然后才能把 `.github/workflows/update.yml` 推上去。
2. **配置翻译密钥**:仓库 Settings → Secrets and variables → Actions 添加
   `AGNES_API_KEY`(值取本地 `.env`)。不配也行 —— 翻译步骤会自动跳过,数据更新与部署照常。
3. **Pages 来源**:仓库 Settings → Pages → Source 选 "GitHub Actions"。

> 工作流只靠 cron + 手动触发(`workflow_dispatch`),提交回仓库带 `[skip ci]`,
> 不会触发自身造成循环。旧的 `.github/_pending/deploy.yml`(push 触发)保持搁置不启用。

### 手动部署(备用)

```bash
GITHUB_ACTIONS=true npm run build       # 用 Pages 子路径构建
npx gh-pages -d dist -b gh-pages         # 推送到 gh-pages 分支
```

## 数据来源与许可

软件数据来自 [awesome-selfhosted-data](https://github.com/awesome-selfhosted/awesome-selfhosted-data),
以 [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) 授权。
本站为非官方中文导航,数据版权归原项目所有。本仓库代码以 MIT 授权。
