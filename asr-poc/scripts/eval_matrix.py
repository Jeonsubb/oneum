"""교차 유형 일반화 평가 — 모델 × 평가세트 행렬을 한 번에 돌려 마크다운 표로 출력.

설계: 뇌신경장애(마비말장애)로 학습한 모델이 다른 발화장애 유형에도 통하는지 측정.
  - in-domain: 뇌신경장애 held-out 화자 (학습에 쓰지 않은 사람) — 주력 수치
  - out-of-domain: 언어청각장애 / 후두장애 — 일반화 여부

주의: 카테고리 간 절대 CER은 비교하지 말 것 (녹음 조건·문장 난이도가 다름).
      반드시 각 카테고리 내 '범용 대비 상대 개선율'로 해석한다.

사용:
  uv run python scripts/eval_matrix.py \
    --models openai/whisper-small checkpoints/dysarthria-ft \
    --sets 뇌신경장애=data/eval.jsonl 언어청각장애=data/eval_hearing.jsonl \
    --out results/matrix.md
"""
import argparse
import json
import re
import sys
from pathlib import Path

import jiwer
import soundfile as sf
import torch
from transformers import WhisperForConditionalGeneration, WhisperProcessor

sys.path.insert(0, str(Path(__file__).parent))
from eval_wer import normalize  # 두 스크립트의 CER/WER 기준을 동일하게 유지한다


def load_rows(path: str):
    return [
        json.loads(l)
        for l in Path(path).read_text(encoding="utf-8").splitlines()
        if l.strip()
    ]


def score_model(model_id: str, sets: dict, device: str, limit: int):
    """모델을 한 번만 로드해 모든 평가세트를 처리한다 (반복 로드 비용 회피)."""
    processor = WhisperProcessor.from_pretrained(model_id)
    model = WhisperForConditionalGeneration.from_pretrained(model_id).to(device).eval()
    out = {}
    for name, path in sets.items():
        rows = load_rows(path)
        if limit:
            rows = rows[:limit]
        refs, hyps = [], []
        for row in rows:
            audio, sr = sf.read(row["audio"], dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            # large 계열은 fp16 배포이므로 입력 dtype을 모델에 맞춘다.
            feats = processor(audio, sampling_rate=sr, return_tensors="pt").input_features.to(
                device=device, dtype=model.dtype)
            with torch.no_grad():
                ids = model.generate(feats, language="ko", task="transcribe")
            hyps.append(processor.decode(ids[0], skip_special_tokens=True).strip())
            refs.append(row["text"].strip())
        # 구두점·띄어쓰기 차이가 오류로 잡히지 않도록 정규화 후 계산한다.
        # CER은 공백 제거, WER은 어절 경계가 필요하므로 유지.
        out[name] = {
            "cer": jiwer.cer([normalize(r, False) or "_" for r in refs],
                             [normalize(h, False) or "_" for h in hyps]),
            "wer": jiwer.wer([normalize(r, True) or "_" for r in refs],
                             [normalize(h, True) or "_" for h in hyps]),
            "n": len(refs),
        }
        print(f"  [{name}] CER {out[name]['cer']:.1%} WER {out[name]['wer']:.1%} (n={len(refs)})")
    del model
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", required=True, help="첫 번째를 베이스라인으로 취급")
    ap.add_argument("--sets", nargs="+", required=True, help="이름=manifest.jsonl 형식")
    ap.add_argument("--device", default="mps")
    ap.add_argument("--limit", type=int, default=0, help="세트당 최대 발화 수 (0=전체)")
    ap.add_argument("--out", default="results/matrix.md")
    args = ap.parse_args()

    sets = dict(s.split("=", 1) for s in args.sets)
    results = {}
    for m in args.models:
        print(f"평가 중: {m}")
        results[m] = score_model(m, sets, args.device, args.limit)

    base, *rest = args.models
    lines = [
        "# 교차 유형 일반화 평가 결과",
        "",
        "> 카테고리 간 절대 CER 비교 금지 — 녹음 조건·문장 난이도가 달라 동일 기준이 아님.",
        "> 각 행(카테고리) 안에서 베이스라인 대비 **상대 개선율**로만 해석할 것.",
        "",
        "| 평가 세트 | n | " + " | ".join(Path(m).name for m in args.models) + " | 상대 개선 |",
        "|---" * (len(args.models) + 3) + "|",
    ]
    for name in sets:
        cells = [f"CER {results[m][name]['cer']:.1%} / WER {results[m][name]['wer']:.1%}" for m in args.models]
        b = results[base][name]["cer"]
        improvements = []
        for m in rest:
            f = results[m][name]["cer"]
            improvements.append(f"{(b - f) / b * 100:+.1f}%" if b > 0 else "n/a")
        lines.append(
            f"| {name} | {results[base][name]['n']} | " + " | ".join(cells) + " | " + ", ".join(improvements) + " |"
        )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n" + "\n".join(lines))
    print(f"\n→ {out}")


if __name__ == "__main__":
    main()
