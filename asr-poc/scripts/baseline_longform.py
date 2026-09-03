"""장문 녹음(수 분~수십 분)에 대한 범용 ASR 베이스라인 측정.

AI Hub 구음장애 데이터는 발화 단위 타임스탬프가 없고 파일 하나에 전체 낭독이 담겨 있다.
따라서 세그먼트 정렬 없이도 유효한 측정 방법으로, 파일 전체를 청크 추론해
전체 전사문과 CER/WER을 비교한다.

사용: uv run python scripts/baseline_longform.py --audio-dir data/raw/audio_sample --label-dir data/raw/labels/train
"""
import argparse
import json
import re
import time
from pathlib import Path

import jiwer
import soundfile as sf
import torch
import torchaudio
from transformers import pipeline


def normalize(text: str) -> str:
    """구두점·공백 차이를 제거해 발화 내용만 비교한다. 'A+B' 정정표기는 공백으로 분리."""
    text = text.replace("+", " ")
    text = re.sub(r"[^가-힣a-zA-Z0-9]", "", text)
    return text


def load_16k(path: Path):
    audio, sr = sf.read(str(path), dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != 16000:
        audio = torchaudio.functional.resample(torch.from_numpy(audio), sr, 16000).numpy()
    return audio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio-dir", required=True)
    ap.add_argument("--label-dir", required=True)
    ap.add_argument("--model", default="openai/whisper-small")
    ap.add_argument("--device", default="mps")
    ap.add_argument("--max-minutes", type=float, default=20, help="이보다 긴 파일은 건너뜀")
    ap.add_argument("--batch-size", type=int, default=8)
    args = ap.parse_args()

    labels = {p.stem: p for p in Path(args.label_dir).rglob("*.json")}
    asr = pipeline(
        "automatic-speech-recognition",
        model=args.model,
        device=args.device,
        chunk_length_s=30,
        batch_size=args.batch_size,
    )

    refs, hyps, per_file = [], [], []
    for wav in sorted(Path(args.audio_dir).glob("*.wav")):
        label = labels.get(wav.stem)
        if not label:
            print(f"  라벨 없음, 건너뜀: {wav.name}")
            continue
        dur = sf.info(str(wav)).duration / 60
        if dur > args.max_minutes:
            print(f"  {dur:.0f}분으로 너무 김, 건너뜀: {wav.name}")
            continue

        ref = json.loads(label.read_text(encoding="utf-8-sig"))["Transcript"]
        audio = load_16k(wav)
        t0 = time.time()
        hyp = asr(audio, generate_kwargs={"language": "ko", "task": "transcribe"})["text"]
        elapsed = time.time() - t0

        nr, nh = normalize(ref), normalize(hyp)
        cer = jiwer.cer(nr, nh)
        per_file.append((wav.stem, dur, cer, elapsed))
        refs.append(nr)
        hyps.append(nh)
        print(f"  {wav.stem[:38]:40s} {dur:5.1f}분  CER {cer:6.1%}  ({elapsed:.0f}초 소요)")
        print(f"      정답: {ref[:60]}...")
        print(f"      인식: {hyp[:60]}...")

    if refs:
        print(f"\n=== {args.model} 전체 {len(refs)}파일 ===")
        print(f"CER {jiwer.cer(refs, hyps):.1%}  (파일별 평균 {sum(c for _,_,c,_ in per_file)/len(per_file):.1%})")


if __name__ == "__main__":
    main()
