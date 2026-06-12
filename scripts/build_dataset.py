#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解析 .cache/ 下的 YAML 数据,计算健康分与状态标签,输出 public/data.json。

健康分(0~100)综合:star 数(对数归一)、近6个月 commit 活跃度、
是否归档、最后更新距今、是否有近一年内的 release。
无 GitHub 元数据的条目(如自建 gitea)给中性分,不罚不奖。
"""
import datetime
import json
import math
import os

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
OUT = os.path.join(ROOT, "public", "data.json")

TODAY = datetime.date(2026, 6, 12)  # 构建基准日,避免运行时漂移影响可复现性

# 状态标签
STATUS_ACTIVE = "active"      # 🔥 活跃
STATUS_NORMAL = "normal"      # ✅ 正常
STATUS_STALE = "stale"        # ⚠️ 停更
STATUS_ARCHIVED = "archived"  # ❌ 已归档
STATUS_UNKNOWN = "unknown"    # 无 GitHub 元数据


def load_yaml(path):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def parse_date(value):
    """字段可能是 'YYYY-MM-DD' 字符串或已被 yaml 解析成 date。"""
    if value is None:
        return None
    if isinstance(value, datetime.date):
        return value
    try:
        return datetime.datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def recent_commits(commit_history, months=6):
    """取 commit_history 末尾最多 months 个月的提交总数。"""
    if not commit_history:
        return 0
    values = list(commit_history.values())
    return sum(values[-months:])


def months_since(date_obj):
    if date_obj is None:
        return None
    return (TODAY.year - date_obj.year) * 12 + (TODAY.month - date_obj.month)


def compute_health(entry):
    """返回 (score 0~100, status)。无 GitHub 元数据时 status=unknown。"""
    has_meta = "stargazers_count" in entry or "commit_history" in entry
    if not has_meta:
        return None, STATUS_UNKNOWN

    if entry.get("archived"):
        return 0, STATUS_ARCHIVED

    stars = entry.get("stargazers_count", 0) or 0
    # star 对数归一:1k star≈30 分,10k≈40,50k≈47,上限 50
    star_score = min(50.0, math.log10(stars + 1) * 10) if stars > 0 else 0.0

    # 活跃度:近6个月 commit 数,30+ 提交拿满 30 分
    commits = recent_commits(entry.get("commit_history"), months=6)
    activity_score = min(30.0, commits / 30.0 * 30.0)

    # 新鲜度:最后更新距今,越近越高,最高 15 分
    upd_months = months_since(parse_date(entry.get("updated_at")))
    if upd_months is None:
        fresh_score = 0.0
    elif upd_months <= 1:
        fresh_score = 15.0
    elif upd_months <= 6:
        fresh_score = 10.0
    elif upd_months <= 12:
        fresh_score = 5.0
    else:
        fresh_score = 0.0

    # release 加分:一年内有发布 +5
    rel = entry.get("current_release") or {}
    rel_months = months_since(parse_date(rel.get("published_at")))
    release_score = 5.0 if rel_months is not None and rel_months <= 12 else 0.0

    score = round(star_score + activity_score + fresh_score + release_score)

    # 状态判定
    if upd_months is not None and upd_months > 12:
        status = STATUS_STALE
    elif commits == 0 and (upd_months is None or upd_months > 6):
        status = STATUS_STALE
    elif commits >= 20 and (upd_months is not None and upd_months <= 2):
        status = STATUS_ACTIVE
    else:
        status = STATUS_NORMAL

    return score, status


def build_software(path):
    entry = load_yaml(path)
    if not entry or "name" not in entry:
        return None
    score, status = compute_health(entry)
    rel = entry.get("current_release") or {}
    platforms = entry.get("platforms") or []
    return {
        "name": entry["name"],
        "description": entry.get("description", ""),
        "website_url": entry.get("website_url", ""),
        "source_code_url": entry.get("source_code_url", ""),
        "demo_url": entry.get("demo_url", ""),
        "licenses": entry.get("licenses") or [],
        "platforms": platforms,
        "tags": entry.get("tags") or [],
        "stars": entry.get("stargazers_count", 0) or 0,
        "updated_at": str(entry.get("updated_at", "")) if entry.get("updated_at") else "",
        "archived": bool(entry.get("archived", False)),
        "release_tag": rel.get("tag", ""),
        "has_docker": any(p.lower() == "docker" for p in platforms),
        "health_score": score,
        "status": status,
    }


def main():
    # 软件
    sw_dir = os.path.join(CACHE, "software")
    software = []
    for fn in sorted(os.listdir(sw_dir)):
        if not fn.endswith(".yml"):
            continue
        item = build_software(os.path.join(sw_dir, fn))
        if item:
            software.append(item)

    # 分类(带描述)
    tags = []
    tag_dir = os.path.join(CACHE, "tags")
    for fn in sorted(os.listdir(tag_dir)):
        if not fn.endswith(".yml"):
            continue
        t = load_yaml(os.path.join(tag_dir, fn))
        if t and "name" in t and not t.get("redirect"):
            tags.append({"name": t["name"], "description": t.get("description", "")})

    # 许可证字典
    licenses = {}
    lic = load_yaml(os.path.join(CACHE, "licenses.yml")) or []
    for entry in lic:
        if "identifier" in entry:
            licenses[entry["identifier"]] = {
                "name": entry.get("name", ""),
                "url": entry.get("url", ""),
            }

    data = {
        "generated_at": str(TODAY),
        "source": "https://github.com/awesome-selfhosted/awesome-selfhosted-data (CC-BY-SA)",
        "software": software,
        "tags": tags,
        "licenses": licenses,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    # 摘要
    by_status = {}
    for s in software:
        by_status[s["status"]] = by_status.get(s["status"], 0) + 1
    print(f"软件: {len(software)} | 分类: {len(tags)} | 许可证: {len(licenses)}")
    print(f"状态分布: {by_status}")
    print(f"输出: {OUT}")


if __name__ == "__main__":
    main()

