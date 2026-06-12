#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""补全 Codeberg(Gitea) 托管项目的元数据。

上游 awesome-selfhosted-data 只抓 GitHub,codeberg.org 项目缺 updated_at/stars,
导致前端「更新时间」显示未知。本脚本调 Codeberg Gitea API 把 updated_at、
stargazers_count、archived 写回 .cache/software/*.yml,供 build_dataset.py 读取。

免 token,只读公开仓库。失败的条目跳过(保持未知),不中断整体构建。
在 fetch_data.py 之后、build_dataset.py 之前运行。
"""
import os
import sys
import time
from urllib.parse import urlparse

import requests
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SW_DIR = os.path.join(ROOT, ".cache", "software")
API = "https://codeberg.org/api/v1/repos/{owner}/{repo}"
TIMEOUT = 20
SLEEP = 0.3  # 轻微限速,避免触发 Gitea 速率限制


def parse_owner_repo(url):
    """从 https://codeberg.org/owner/repo[/...] 提取 (owner, repo)。"""
    parts = urlparse(url).path.strip("/").split("/")
    if len(parts) < 2 or not parts[0] or not parts[1]:
        return None
    return parts[0], parts[1].removesuffix(".git")


def fetch_meta(owner, repo):
    """返回 {updated_at, stargazers_count, archived} 或 None。"""
    try:
        r = requests.get(API.format(owner=owner, repo=repo), timeout=TIMEOUT)
        if r.status_code != 200:
            return None
        d = r.json()
    except (requests.RequestException, ValueError):
        return None
    updated = d.get("updated_at")
    if not updated:
        return None
    return {
        "updated_at": updated[:10],  # 取 YYYY-MM-DD,与上游格式一致
        "stargazers_count": d.get("stars_count", 0) or 0,
        "archived": bool(d.get("archived", False)),
    }


def main():
    files = [f for f in os.listdir(SW_DIR) if f.endswith(".yml")]
    targets = []
    for fn in files:
        path = os.path.join(SW_DIR, fn)
        with open(path, "r", encoding="utf-8") as f:
            entry = yaml.safe_load(f) or {}
        url = entry.get("source_code_url", "") or ""
        if "codeberg.org" in url and "updated_at" not in entry:
            targets.append((path, entry, url))

    print(f"待补全 Codeberg 项目: {len(targets)}")
    filled = 0
    for path, entry, url in targets:
        pr = parse_owner_repo(url)
        if not pr:
            continue
        meta = fetch_meta(*pr)
        time.sleep(SLEEP)
        if not meta:
            print(f"  跳过(无数据): {entry.get('name')}")
            continue
        entry.update(meta)
        with open(path, "w", encoding="utf-8") as f:
            yaml.safe_dump(entry, f, allow_unicode=True, sort_keys=False)
        filled += 1
        print(f"  ✓ {entry.get('name')} -> {meta['updated_at']} ★{meta['stargazers_count']}")

    print(f"完成。补全 {filled}/{len(targets)} 个。")


if __name__ == "__main__":
    main()
