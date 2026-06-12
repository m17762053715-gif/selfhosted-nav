#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拉取 awesome-selfhosted-data 数据仓库到本地 .cache/。
可重复运行:已存在则 git pull 更新,否则浅克隆。
"""
import os
import subprocess
import sys

REPO_URL = "https://github.com/awesome-selfhosted/awesome-selfhosted-data.git"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT, ".cache")


def run(cmd, cwd=None):
    print(f"$ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        raise SystemExit(f"command failed (exit {result.returncode})")
    return result.stdout


def main():
    if os.path.isdir(os.path.join(CACHE_DIR, ".git")):
        print("数据仓库已存在,执行 git pull 更新...")
        run(["git", "pull", "--depth", "1", "--rebase"], cwd=CACHE_DIR)
    else:
        print("浅克隆数据仓库...")
        run(["git", "clone", "--depth", "1", REPO_URL, CACHE_DIR])

    sw = os.path.join(CACHE_DIR, "software")
    count = len([f for f in os.listdir(sw) if f.endswith(".yml")])
    print(f"完成。software 条目数: {count}")


if __name__ == "__main__":
    main()
