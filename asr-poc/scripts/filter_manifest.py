"""정렬 신뢰도가 낮은 클립을 걸러 평가셋을 정제한다.

DP 정렬은 여러 세그먼트를 한 문장에 병합할 때(MAX_MERGE) 어긋나기 쉽다. 실측상
10초를 넘는 클립은 초당 글자수가 6.46자(5초 이하)에서 3.13자로 떨어져 라벨이 실제
발화와 맞지 않는다. 실제로 30초 클립 하나에 엉뚱한 문장이 붙어 평가 전체를 왜곡했다.

두 기준으로 거른다.
  ① 길이 상한 — 온음이 다루는 발화는 한 문장(3~5초)이다. 긴 낭독은 서비스 도메인도 아니다.
  ② 초당 글자수가 같은 화자의 중앙값에서 크게 벗어나면 정렬 오류로 본다.
    화자마다 말 속도가 다르므로 절대 기준이 아니라 화자별 상대 기준을 쓴다.

사용: uv run python scripts/filter_manifest.py --in data/eval.jsonl --out data/eval_clean.jsonl
"""
import argparse, json, statistics
from collections import defaultdict
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--in", dest="src", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--max-sec", type=float, default=10.0)
ap.add_argument("--cps-low", type=float, default=0.5, help="화자 중앙값 대비 하한")
ap.add_argument("--cps-high", type=float, default=2.0, help="화자 중앙값 대비 상한")
ap.add_argument("--kind", default="문장형")
a = ap.parse_args()

rows = [json.loads(l) for l in Path(a.src).read_text(encoding="utf-8").splitlines() if l.strip()]
n0 = len(rows)
if a.kind:
    rows = [r for r in rows if r.get("kind") == a.kind]
n1 = len(rows)
rows = [r for r in rows if r["duration"] <= a.max_sec]
n2 = len(rows)

by = defaultdict(list)
for r in rows:
    by[r["speaker"]].append(r)
kept = []
for v in by.values():
    med = statistics.median(len(r["text"]) / r["duration"] for r in v)
    for r in v:
        ratio = (len(r["text"]) / r["duration"]) / med
        if a.cps_low <= ratio <= a.cps_high:
            kept.append(r)

Path(a.out).write_text(
    "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept), encoding="utf-8")
print(f"{n0} → 유형필터 {n1} → 길이≤{a.max_sec}초 {n2} → 초당글자수 이상치 제거 {len(kept)}")
print(f"화자 {len({r['speaker'] for r in kept})}명 / {sum(r['duration'] for r in kept)/60:.1f}분 → {a.out}")
