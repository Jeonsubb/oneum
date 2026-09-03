"""기본 모델 vs 파인튜닝 모델 CER/WER 비교 — 이 표가 곧 기획서의 실증 데모.

사용:
  uv run python scripts/eval_wer.py --manifest data/eval.jsonl \\
      --models openai/whisper-small checkpoints/whisper-small-dysarthria
  ... --models openai/whisper-small openai/whisper-large-v3-turbo checkpoints/... --limit 200

큰 모델을 비교군에 넣는 이유: "파라미터를 키우면 해결된다"는 통념을 반증하기 위해서다.
large는 학습하지 않고 추론만 하므로 비용이 거의 들지 않으면서,
"큰 모델도 구음장애 발화에서는 개선이 미미하지만 작은 모델도 도메인 적응은 효과가 있다"는
논거를 수치로 만든다.
"""
import argparse
import gc
import json
import re
from pathlib import Path

import jiwer
import soundfile as sf
import torch
from transformers import WhisperForConditionalGeneration, WhisperProcessor


def normalize(text: str, keep_space: bool) -> str:
    """구두점·정정표기 차이를 제거해 발화 내용만 비교한다.

    정답 "휴지를 버려 주세요."와 인식 "휴지를 버려주세요"가 구두점·띄어쓰기 때문에
    오류로 잡히면 CER이 부풀려진다. CER은 공백을 제거하고, WER은 어절 경계가 필요하므로 유지한다.
    'A+B'는 재발화, '그래*'는 중단 발화 표기이므로 정리한다.
    """
    text = text.replace("+", " ").replace("*", "")
    text = re.sub(r"[^가-힣a-zA-Z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if keep_space else text.replace(" ", "")


def transcribe_all(model_id: str, rows: list[dict], device: str, guard: bool = False) -> list[str]:
    processor = WhisperProcessor.from_pretrained(model_id)
    model = WhisperForConditionalGeneration.from_pretrained(model_id).to(device).eval()
    hyps = []
    for n, row in enumerate(rows, 1):
        audio, sr = sf.read(row["audio"], dtype="float32")
        # large 계열은 fp16으로 배포된다. 입력을 모델 dtype에 맞추지 않으면
        # "Input type (float) and bias type (c10::Half) should be the same"로 죽는다.
        feats = processor(audio, sampling_rate=sr, return_tensors="pt").input_features.to(
            device=device, dtype=model.dtype)
        with torch.no_grad():
            if guard:
                # 특정 화자에서 같은 구절을 60토큰 이상 반복하는 환각이 관측됐다(CER 198%).
                # 정렬 검증 때 max_new_tokens 제한만으로 CER이 272.9%→55.7%로 잡힌 전례가 있어
                # 반복 억제와 길이 상한을 함께 건다. 학습 없이 생성 단계에서만 처리한다.
                ids = model.generate(
                    feats, language="ko", task="transcribe",
                    repetition_penalty=1.15, no_repeat_ngram_size=3, max_new_tokens=120)
            else:
                ids = model.generate(feats, language="ko", task="transcribe")
        hyps.append(processor.decode(ids[0], skip_special_tokens=True).strip())
        if n % 50 == 0:
            print(f"    {n}/{len(rows)}", flush=True)
    # 다음 모델을 올리기 전에 확실히 내린다 — large 계열을 이어 돌릴 때 메모리가 터진다
    del model, processor
    gc.collect()
    if device == "mps":
        torch.mps.empty_cache()
    return hyps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--models", nargs="+", required=True)
    ap.add_argument("--limit", type=int, default=0, help="평가할 클립 수 (0=전부)")
    ap.add_argument("--out", help="마크다운 표를 저장할 경로 (기획서에 그대로 인용)")
    ap.add_argument("--guard", action="store_true",
                    help="반복 억제·길이 상한을 걸어 환각을 막는다 (학습 불필요, 생성 단계 처리)")
    args = ap.parse_args()

    rows = [json.loads(l) for l in Path(args.manifest).read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.limit:
        rows = rows[: args.limit]
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    print(f"평가 클립 {len(rows)}개 / device={device}\n")

    refs_cer = [normalize(r["text"], keep_space=False) for r in rows]
    refs_wer = [normalize(r["text"], keep_space=True) for r in rows]

    results = []
    for m in args.models:
        print(f"[{m}] 추론 중...")
        hyps = transcribe_all(m, rows, device, args.guard)
        h_cer = [normalize(h, keep_space=False) or "_" for h in hyps]
        h_wer = [normalize(h, keep_space=True) or "_" for h in hyps]
        cer = jiwer.cer([r or "_" for r in refs_cer], h_cer)
        wer = jiwer.wer([r or "_" for r in refs_wer], h_wer)
        results.append((m, cer, wer))
        print(f"  → CER {cer:.1%} | WER {wer:.1%}\n")

    lines = [f"| 모델 | CER | WER | 베이스 대비 CER 개선 |", "|---|---|---|---|"]
    base_cer = results[0][1]
    for m, cer, wer in results:
        rel = (base_cer - cer) / base_cer * 100 if base_cer else 0.0
        mark = "—" if m == results[0][0] else f"{rel:+.1f}%"
        lines.append(f"| `{m}` | {cer:.1%} | {wer:.1%} | {mark} |")
    table = "\n".join(lines)
    print(table)
    print(f"\n(평가 클립 {len(rows)}개, 화자 {len(set(r['speaker'] for r in rows))}명)")
    print("주의: 카테고리가 다른 평가셋 간 절대 CER 비교는 금지. 같은 셋 안에서 상대 개선율로만 판단한다.")

    if args.out:
        Path(args.out).write_text(
            table + f"\n\n평가 클립 {len(rows)}개 / 화자 {len(set(r['speaker'] for r in rows))}명\n",
            encoding="utf-8")
        print(f"\n→ {args.out}")


if __name__ == "__main__":
    main()
