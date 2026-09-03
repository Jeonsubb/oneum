"""파일 단위 정렬 검사 — 통째로 밀린 파일을 찾아 교정하거나 제외한다.

클립 단위 필터(`filter_manifest.py`)는 길이·초당 글자수 이상치를 걸러내지만, **파일 전체가
k칸 밀린 경우는 잡지 못한다.** 밀려도 클립 길이와 글자수의 비례 관계는 유지되기 때문이다.
실제로 유형 15 평가셋에서 길이 상관이 r=0.834로 정상인데 내용은 전부 다른 파일이 있었다.

검사 방법: 각 파일에서 클립을 순서대로 뽑아 베이스 모델로 인식하고, 라벨을 -3~+3칸
이동시키며 offset별 CER을 구한다. 판정 기준은 **CER 절대값이 아니라 offset 간 대비**다.
  - 대비 있음 + 최적 offset 0    → 정상
  - 대비 있음 + 최적 offset ≠ 0  → 통째로 밀림. `--fix`로 라벨을 shift해 되살린다
  - 대비 없음(< --min-contrast)  → 어느 지점에서도 안 맞음 = 정렬 실패. 제외

절대 CER로 거르면 안 되는 이유: 구음장애가 심한 화자는 라벨이 제자리에 있어도 베이스 모델
CER이 70~80%까지 나온다. 절대값으로 자르면 **중증 화자가 통째로 학습에서 빠져 모델이 경증에
편향된다.** 반면 정렬이 맞으면 절대 CER이 높아도 그 지점에서만 값이 급락한다
(실측: 정상 파일 offset 0에서 0.0%, ±1에서 46.3%). 이 대비가 정렬 여부의 진짜 신호다.

사용:
  uv run python scripts/check_alignment.py --manifest data/train_clean.jsonl \\
      --report results/alignment_report.json
  uv run python scripts/check_alignment.py --manifest data/train_clean.jsonl \\
      --report results/alignment_report.json --fix --out data/train_aligned.jsonl
"""
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

import jiwer
import soundfile as sf
import torch
from transformers import WhisperForConditionalGeneration, WhisperProcessor


def norm(t: str) -> str:
    return re.sub(r"[^가-힣a-zA-Z0-9]", "", t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", help="교정·정제된 manifest 저장 경로 (--fix와 함께)")
    ap.add_argument("--report", default="results/alignment_report.json")
    ap.add_argument("--model", default="openai/whisper-small")
    ap.add_argument("--sample", type=int, default=15, help="파일당 검사할 클립 수")
    ap.add_argument("--max-offset", type=int, default=3)
    ap.add_argument("--min-contrast", type=float, default=0.20,
                    help="최적 offset과 차선 offset의 CER 차이가 이보다 작으면 정렬 실패로 본다. "
                         "CER 절대값으로 거르면 중증 화자가 배제되므로 대비로 판정한다")
    ap.add_argument("--fix", action="store_true", help="밀린 파일의 라벨을 shift해 되살린다")
    args = ap.parse_args()

    rows = [json.loads(l) for l in Path(args.manifest).read_text(encoding="utf-8").splitlines() if l.strip()]
    by_src = defaultdict(list)
    for r in rows:
        by_src[r["source"]].append(r)
    for v in by_src.values():
        v.sort(key=lambda r: r["unit_index"])

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    processor = WhisperProcessor.from_pretrained(args.model)
    model = WhisperForConditionalGeneration.from_pretrained(args.model).to(device).eval()
    print(f"파일 {len(by_src)}개 검사 (파일당 최대 {args.sample}클립) / device={device}\n")

    report = {}
    for n, (src, clips) in enumerate(sorted(by_src.items()), 1):
        seq = clips[: args.sample]
        if len(seq) < 4:
            report[src] = {"offset": 0, "cer": None, "verdict": "표본부족", "n": len(seq)}
            continue

        hyps = []
        for r in seq:
            audio, sr = sf.read(r["audio"], dtype="float32")
            feats = processor(audio, sampling_rate=sr, return_tensors="pt").input_features.to(
                device=device, dtype=model.dtype)
            with torch.no_grad():
                ids = model.generate(feats, language="ko", task="transcribe",
                                     max_new_tokens=min(max(len(norm(r["text"])) * 2 + 8, 16), 180))
            hyps.append(norm(processor.decode(ids[0], skip_special_tokens=True)) or "_")
        refs = [norm(r["text"]) or "_" for r in seq]

        by_off = {}
        for k in range(-args.max_offset, args.max_offset + 1):
            pair = [(refs[i + k], hyps[i]) for i in range(len(seq)) if 0 <= i + k < len(seq)]
            if len(pair) < 3:
                continue
            by_off[k] = jiwer.cer([p[0] for p in pair], [p[1] for p in pair])
        if not by_off:
            report[src] = {"offset": 0, "cer": None, "verdict": "표본부족", "n": len(clips)}
            continue

        off = min(by_off, key=by_off.get)
        cer = by_off[off]
        others = [v for k, v in by_off.items() if k != off]
        # 판정의 핵심은 CER 절대값이 아니라 offset 간 대비다.
        # 정렬이 맞으면 그 지점에서 CER이 급락한다(실측: 0.0% vs 이웃 46.3%).
        # 발화가 심해 절대 CER이 높아도 라벨이 제자리면 대비는 남는다. 절대값으로 거르면
        # 중증 화자가 통째로 빠져 모델이 경증에 편향된다.
        contrast = (min(others) - cer) if others else 0.0

        if contrast < args.min_contrast:
            verdict = "정렬실패"      # 어느 offset에서도 비슷 = 라벨이 무작위
        elif off != 0:
            verdict = "밀림"          # 다른 지점에서 급락 = 통째로 밀림, 교정 가능
        else:
            verdict = "정상"
        report[src] = {"offset": off, "cer": round(cer, 4), "contrast": round(contrast, 4),
                       "verdict": verdict, "n": len(clips),
                       "by_offset": {str(k): round(v, 4) for k, v in sorted(by_off.items())}}
        if n % 20 == 0 or verdict != "정상":
            print(f"  [{n}/{len(by_src)}] {src[:36]:36s} {verdict:6s} off {off:+d} CER {cer:.1%} 대비 {contrast:+.1%}", flush=True)

    Path(args.report).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")

    counts = defaultdict(int)
    clips_by_verdict = defaultdict(int)
    for src, v in report.items():
        counts[v["verdict"]] += 1
        clips_by_verdict[v["verdict"]] += v["n"]
    print(f"\n=== 판정 요약 ===")
    for k in ("정상", "밀림", "정렬실패", "표본부족"):
        if counts[k]:
            print(f"  {k:8s} 파일 {counts[k]:3d}개 / 클립 {clips_by_verdict[k]:6,}개")
    print(f"\n→ {args.report}")

    if args.fix and args.out:
        kept = []
        for src, clips in by_src.items():
            v = report[src]
            if v["verdict"] == "정렬실패":
                continue
            off = v["offset"]
            if off == 0:
                kept.extend(clips)
                continue
            # 라벨이 off칸 밀렸다 = 클립 i의 정답은 현재 i+off번 클립에 붙어 있다
            texts = [c["text"] for c in clips]
            for i, c in enumerate(clips):
                j = i + off
                if 0 <= j < len(texts):
                    c = dict(c)
                    c["text"] = texts[j]
                    c["fixed_offset"] = off
                    kept.append(c)
        Path(args.out).write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept), encoding="utf-8")
        print(f"교정·정제 결과: {len(rows):,} → {len(kept):,}클립 → {args.out}")


if __name__ == "__main__":
    main()
