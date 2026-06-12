# 自托管导航 · SelfHosted Nav

一个比官网更好用的**中文自托管开源软件导航站**。数据来自
[awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted-data),
共收录 1300+ 款可自托管的开源软件。

## 相比官网的改进

- **中文界面** —— 全部软件描述与分类名翻译为简体中文(可一键切回英文)
- **健康度排序** —— 综合 star 数、近半年提交活跃度、是否归档、最新发布,
  给每个项目算 0~100 健康分,一眼看出哪些靠谱
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
python scripts/build_dataset.py     # 解析 + 计算健康分 -> public/data.json
AGNES_API_KEY=xxx python scripts/translate.py   # 增量翻译新增条目
```

翻译带缓存,只翻译尚未翻过的条目,可中断续跑。

## 部署

线上地址:https://m17762053715-gif.github.io/selfhosted-nav/

当前用 `gh-pages` 分支手动部署。更新站点:

```bash
GITHUB_ACTIONS=true npm run build       # 用 Pages 子路径构建
npx gh-pages -d dist -b gh-pages         # 推送到 gh-pages 分支
```

> 自动部署:`.github/_pending/deploy.yml` 是一份 GitHub Actions 工作流。
> 待 gh token 获得 `workflow` 权限后(`gh auth refresh -s workflow`),
> 将其移回 `.github/workflows/` 并推送,即可改为 push 自动部署。

## 数据来源与许可

软件数据来自 [awesome-selfhosted-data](https://github.com/awesome-selfhosted/awesome-selfhosted-data),
以 [CC-BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) 授权。
本站为非官方中文导航,数据版权归原项目所有。本仓库代码以 MIT 授权。
