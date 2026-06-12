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

from categories import GROUP_META, classify

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
OUT = os.path.join(ROOT, "public", "data.json")
HISTORY_OUT = os.path.join(ROOT, "public", "star_history.json")

HISTORY_DAYS = 30  # star 历史滚动保留天数

# 构建基准日:CI 每日跑用真实 today 推进历史;
# 设 SNAPSHOT_DATE 可覆盖(本地复现测试用)。
_snapshot = os.environ.get("SNAPSHOT_DATE")
TODAY = datetime.date.fromisoformat(_snapshot) if _snapshot else datetime.date.today()

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


def load_history():
    """读 star_history.json,不存在或损坏则返回空。"""
    if not os.path.isfile(HISTORY_OUT):
        return {}
    try:
        with open(HISTORY_OUT, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_history(history):
    os.makedirs(os.path.dirname(HISTORY_OUT), exist_ok=True)
    with open(HISTORY_OUT, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, separators=(",", ":"))


def prune_history(history):
    """只保留最近 HISTORY_DAYS 个有数据的日期,裁掉更老的快照。"""
    all_dates = set()
    for name, snaps in history.items():
        if name == "_meta":
            continue
        all_dates.update(snaps.keys())
    keep = set(sorted(all_dates)[-HISTORY_DAYS:])
    for name in list(history.keys()):
        if name == "_meta":
            continue
        history[name] = {d: v for d, v in history[name].items() if d in keep}
        if not history[name]:
            del history[name]
    history["_meta"] = {"dates": sorted(keep)}
    return history


def compute_deltas(snaps, today_str):
    """由单个项目的 {date: stars} 快照算今日/7日涨幅。
    1d = 今日 - 最近一个早于今日的快照;7d = 今日 - ≤7天前最接近的快照。
    缺历史则返回 None。"""
    today_val = snaps.get(today_str)
    if today_val is None:
        return None, None
    past = sorted(d for d in snaps if d < today_str)
    if not past:
        return None, None

    delta_1d = today_val - snaps[past[-1]]

    today_date = datetime.date.fromisoformat(today_str)
    cutoff = (today_date - datetime.timedelta(days=7)).isoformat()
    # 取 ≤7 天前里最接近 cutoff 的快照(即第一个 >= cutoff 的更早点,容错缺天)
    on_or_before_week = [d for d in past if d <= cutoff]
    base_7d_date = on_or_before_week[-1] if on_or_before_week else past[0]
    delta_7d = today_val - snaps[base_7d_date]

    return delta_1d, delta_7d


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


# 新鲜度档位:按最后更新距今的月数划分,供前端「更新时间」筛选
FRESH_RECENT = "recent"    # 🟢 近 1 年内
FRESH_1Y = "y1"            # 🟡 1~2 年前
FRESH_2Y = "y2"            # 🟠 2~3 年前
FRESH_OLD = "old"          # 🔴 3 年以上
FRESH_UNKNOWN = "unknown"  # ⚪ 无更新时间(自建仓库)


def freshness(updated_at):
    months = months_since(parse_date(updated_at))
    if months is None:
        return FRESH_UNKNOWN
    if months <= 12:
        return FRESH_RECENT
    if months <= 24:
        return FRESH_1Y
    if months <= 36:
        return FRESH_2Y
    return FRESH_OLD


def build_software(path):
    entry = load_yaml(path)
    if not entry or "name" not in entry:
        return None
    score, status = compute_health(entry)
    rel = entry.get("current_release") or {}
    platforms = entry.get("platforms") or []
    tags = entry.get("tags") or []
    group, sub = classify(entry["name"], tags)
    return {
        "name": entry["name"],
        "description": entry.get("description", ""),
        "website_url": entry.get("website_url", ""),
        "source_code_url": entry.get("source_code_url", ""),
        "demo_url": entry.get("demo_url", ""),
        "licenses": entry.get("licenses") or [],
        "platforms": platforms,
        "tags": tags,
        "group": group,
        "sub": sub,
        "stars": entry.get("stargazers_count", 0) or 0,
        "updated_at": str(entry.get("updated_at", "")) if entry.get("updated_at") else "",
        "freshness": freshness(entry.get("updated_at")),
        "archived": bool(entry.get("archived", False)),
        "release_tag": rel.get("tag", ""),
        "has_docker": any(p.lower() == "docker" for p in platforms),
        "health_score": score,
        "status": status,
    }


def main():
    today_str = str(TODAY)
    history = load_history()

    # 软件
    sw_dir = os.path.join(CACHE, "software")
    software = []
    for fn in sorted(os.listdir(sw_dir)):
        if not fn.endswith(".yml"):
            continue
        item = build_software(os.path.join(sw_dir, fn))
        if item:
            software.append(item)
            # 记录今日 star 快照
            snaps = history.setdefault(item["name"], {})
            snaps[today_str] = item["stars"]

    prune_history(history)

    # 回填涨幅字段
    for item in software:
        d1, d7 = compute_deltas(history.get(item["name"], {}), today_str)
        item["stars_delta_1d"] = d1
        item["stars_delta_7d"] = d7

    save_history(history)

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

    # 两级分类结构:大类 + 其下出现过的小类(按数量降序)
    sub_count = {}
    for s in software:
        key = (s["group"], s["sub"])
        sub_count[key] = sub_count.get(key, 0) + 1
    groups = []
    for gkey, icon, gname in GROUP_META:
        subs = sorted(
            ({"name": sub, "count": n} for (g, sub), n in sub_count.items() if g == gkey),
            key=lambda x: -x["count"],
        )
        total = sum(x["count"] for x in subs)
        if total == 0:
            continue
        groups.append({"key": gkey, "icon": icon, "name": gname, "count": total, "subs": subs})

    data = {
        "generated_at": str(TODAY),
        "source": "https://github.com/awesome-selfhosted/awesome-selfhosted-data (CC-BY-SA)",
        "software": software,
        "groups": groups,
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
    top = sorted(
        (s for s in software if s.get("stars_delta_1d")),
        key=lambda s: s["stars_delta_1d"], reverse=True,
    )[:3]
    print(f"软件: {len(software)} | 分类: {len(tags)} | 许可证: {len(licenses)}")
    print(f"状态分布: {by_status}")
    print(f"星历史日期: {history['_meta']['dates']}")
    if top:
        print("今日涨星 Top3: " + ", ".join(f"{s['name']} +{s['stars_delta_1d']}" for s in top))
    print(f"输出: {OUT}")
    print(f"星历史: {HISTORY_OUT}")


if __name__ == "__main__":
    main()

