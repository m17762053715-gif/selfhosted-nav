#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量翻译软件描述 + 分类名为简体中文,结果缓存到 translations.json。

设计要点:
- 增量:已缓存的不再翻译,可中断续跑
- 批量:一次请求翻多条,省请求数(国内网络每次握手都可能失败)
- 重试:http=000 / 5xx 自动重试(实测境外网关握手不稳)
- 不硬编码 key:从环境变量 AGNES_API_KEY 读,或 .env 文件

用法:
    AGNES_API_KEY=xxx python scripts/translate.py
    AGNES_API_KEY=xxx python scripts/translate.py --limit 50   # 只翻前50条,试跑
"""
import argparse
import json
import os
import sys
import time

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data.json")
CACHE = os.path.join(ROOT, "public", "translations.json")

API_URL = "https://apihub.agnes-ai.com/v1/chat/completions"
MODEL = "agnes-2.0-flash"
BATCH_SIZE = 20          # 每请求翻译条数
MAX_RETRIES = 5          # 单请求最大重试次数
TIMEOUT = 120

SYSTEM_PROMPT = (
    "你是专业技术翻译。把用户给的 JSON 数组里每条英文(自托管开源软件的简短描述)"
    "翻译成简洁、地道的简体中文。保留专有名词和技术术语(如 Docker、API、Markdown、"
    "Git、Notion 等),不要音译。每条控制在一句话。"
    "严格只返回一个等长的 JSON 字符串数组,顺序与输入一致,不要任何解释或代码块标记。"
)


def get_api_key():
    key = os.environ.get("AGNES_API_KEY")
    if not key:
        env_path = os.path.join(ROOT, ".env")
        if os.path.isfile(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("AGNES_API_KEY"):
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
    if not key:
        sys.exit("缺少 AGNES_API_KEY(设为环境变量或写入 .env)")
    return key


def call_api(key, texts):
    """翻译一批文本,返回等长中文列表;失败抛异常。"""
    payload = {
        "model": MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(texts, ensure_ascii=False)},
        ],
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.post(API_URL, headers=headers, json=payload, timeout=TIMEOUT)
            if r.status_code != 200:
                last_err = f"http {r.status_code}: {r.text[:200]}"
                time.sleep(2 * attempt)
                continue
            content = r.json()["choices"][0]["message"]["content"].strip()
            # 去除可能的 ```json 包裹
            if content.startswith("```"):
                content = content.strip("`")
                content = content.split("\n", 1)[1] if "\n" in content else content
                content = content.rsplit("```", 1)[0] if "```" in content else content
            result = json.loads(content)
            if isinstance(result, list) and len(result) == len(texts):
                return result
            last_err = f"返回长度不符: 期望{len(texts)} 实际{len(result) if isinstance(result,list) else '非数组'}"
        except (requests.RequestException, json.JSONDecodeError, KeyError) as e:
            last_err = str(e)[:200]
        time.sleep(2 * attempt)
    raise RuntimeError(f"批次翻译失败(重试{MAX_RETRIES}次): {last_err}")


def load_cache():
    if os.path.isfile(CACHE):
        with open(CACHE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache):
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=0)


def collect_texts(data):
    """收集所有需要翻译的唯一英文文本(描述 + 分类名)。"""
    texts = set()
    for s in data["software"]:
        if s.get("description"):
            texts.add(s["description"])
    for t in data["tags"]:
        if t.get("name"):
            texts.add(t["name"])
    return sorted(texts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="只翻前 N 条(试跑)")
    args = parser.parse_args()

    key = get_api_key()
    with open(DATA, "r", encoding="utf-8") as f:
        data = json.load(f)

    cache = load_cache()
    all_texts = collect_texts(data)
    pending = [t for t in all_texts if t not in cache]
    if args.limit:
        pending = pending[: args.limit]

    print(f"待翻译总条目: {len(all_texts)} | 已缓存: {len(cache)} | 本次翻译: {len(pending)}")
    if not pending:
        print("无新增,缓存已覆盖全部。")
        return

    done = 0
    for i in range(0, len(pending), BATCH_SIZE):
        batch = pending[i : i + BATCH_SIZE]
        try:
            zh = call_api(key, batch)
        except RuntimeError as e:
            # 单批失败:保存已完成进度后退出,下次续跑
            save_cache(cache)
            sys.exit(f"\n中断于第 {i} 条: {e}\n已保存进度,重跑本脚本可续传。")
        for en, cn in zip(batch, zh):
            cache[en] = cn
        done += len(batch)
        save_cache(cache)  # 每批落盘,断点安全
        print(f"  进度 {done}/{len(pending)}  最新: {batch[0][:30]} -> {zh[0][:20]}")

    print(f"完成。缓存覆盖 {len(cache)}/{len(all_texts)} 条。")


if __name__ == "__main__":
    main()

