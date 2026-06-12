#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""冷启动:从 awesome-selfhosted-data 的 git 历史回填过去若干天的 star 快照,
生成初始 public/star_history.json,让站点上线即有涨星榜。

一次性脚本,本地手动跑一次即可;日常增量由 build_dataset.py 推进。
用法:
    python scripts/bootstrap_history.py            # 回填最近 14 天
    python scripts/bootstrap_history.py --days 30
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
SW_DIR = os.path.join(CACHE, "software")
HISTORY_OUT = os.path.join(ROOT, "public", "star_history.json")
DEFAULT_DAYS = 14


def git(args):
    r = subprocess.run(
        ["git", *args], cwd=CACHE, capture_output=True, text=True, encoding="utf-8"
    )
    if r.returncode != 0:
        print(r.stderr, file=sys.stderr)
        raise SystemExit(f"git {' '.join(args)} 失败 (exit {r.returncode})")
    return r.stdout


def ensure_history_depth(days):
    """当前是浅克隆,增量加深到足够覆盖 days 天。
    用 --deepen 而非 --unshallow:只取所需提交,传输量小,
    在弱网下更可靠(完整 unshallow 历史太大易断连)。
    bot 大致每日一次提交,留 1.5 倍余量。"""
    if not os.path.isfile(os.path.join(CACHE, ".git", "shallow")):
        print("已是完整历史,跳过加深。")
        return
    depth = int(days * 1.5) + 5
    print(f"浅克隆,git fetch --deepen={depth} ...")
    git(["fetch", f"--deepen={depth}"])
    have = git(["rev-list", "--count", "HEAD"]).strip()
    print(f"现有提交数: {have}")


def commit_for_date(day):
    """取该自然日(UTC)最后一个 commit 的 hash;无则 None。"""
    until = f"{day.isoformat()} 23:59:59"
    out = git([
        "log", "-1", "--format=%H",
        f"--until={until}",
    ]).strip()
    return out or None


def stars_at_commit(commit):
    """读取某 commit 下所有 software 的 stargazers_count。
    用 git checkout 把该 commit 的 software/ 还原到工作区再批量读文件
    (比逐文件 git show 快几个数量级)。返回 {name: stars}。
    调用方负责最后还原工作区到 HEAD。"""
    git(["checkout", commit, "--", "software"])
    result = {}
    if not os.path.isdir(SW_DIR):
        return result
    for fn in os.listdir(SW_DIR):
        if not fn.endswith(".yml"):
            continue
        try:
            with open(os.path.join(SW_DIR, fn), "r", encoding="utf-8") as f:
                entry = yaml.safe_load(f)
        except (yaml.YAMLError, OSError):
            continue
        if entry and "name" in entry and "stargazers_count" in entry:
            result[entry["name"]] = entry["stargazers_count"]
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=DEFAULT_DAYS)
    args = ap.parse_args()

    ensure_history_depth(args.days)

    today = datetime.date.today()
    history = {}
    used_dates = []

    try:
        for i in range(args.days, -1, -1):  # 从最早到今天
            day = today - datetime.timedelta(days=i)
            commit = commit_for_date(day)
            if not commit:
                print(f"  {day} 无 commit,跳过")
                continue
            stars = stars_at_commit(commit)
            if not stars:
                print(f"  {day} ({commit[:7]}) 读到 0 条,跳过")
                continue
            date_str = day.isoformat()
            used_dates.append(date_str)
            for name, val in stars.items():
                history.setdefault(name, {})[date_str] = val
            print(f"  {day} ({commit[:7]}) -> {len(stars)} 个项目")
    finally:
        # 还原工作区到最新,避免留下旧版 software/
        git(["checkout", "HEAD", "--", "software"])

    history["_meta"] = {"dates": used_dates}
    os.makedirs(os.path.dirname(HISTORY_OUT), exist_ok=True)
    with open(HISTORY_OUT, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\n回填完成。日期: {used_dates}")
    print(f"项目数: {len(history) - 1} | 输出: {HISTORY_OUT}")


if __name__ == "__main__":
    main()
