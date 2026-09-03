"""롱폼 녹음의 세그먼트화 가능성 진단.

AI Hub 구음장애 데이터는 파일 하나에 전체 낭독(평균 25분)이 담겨 있고
발화 단위 타임스탬프가 없다. Whisper 파인튜닝에는 30초 이하 클립이 필요하므로
VAD로 자른 뒤 전사문과 순차 정렬해야 한다.

이 스크립트는 정렬 전략을 확정하기 전에 "그 정렬이 가능한가"를 먼저 측정한다.
VAD 발화 구간 수와 전사문 단위 수(문장 또는 낱말)가 얼마나 맞아떨어지는지 보고,
1:1 매핑 / 병합 / 폐기 중 어떤 전략이 필요한지 판단한다.

사용:
  uv run python scripts/segment_probe.py --audio-dir data/raw/audio_sample --label-dir data/raw/labels
  uv run python scripts/segment_probe.py --audio-dir ... --label-dir ... --limit 20 --dump-segments out.json
"""
import argparse
import json
import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

# Whisper 인코더는 30초 고정 창이다. 이보다 긴 클립은 뒤가 잘려 학습에 쓸 수 없다.
WHISPER_MAX_SEC = 30.0
# 너무 짧은 조각은 잡음·기침일 가능성이 높다.
MIN_SEG_SEC = 0.4
# 구음장애 화자는 한 문장을 여러 번 끊어 읽는다. 400ms로는 문장 내부 휴지까지 잘라
# VAD 구간이 전사 단위의 3~4배까지 튀었다. 1200ms 실측에서 비율이 2.95→1.25로 안정되고
# 30초 초과 세그먼트는 여전히 0%였다.
MIN_SILENCE_MS = 1200


def to_16k_mono(src: Path, dst: Path) -> None:
    """ffmpeg 스트리밍 변환. 8시간짜리 원본도 메모리에 통째로 올리지 않는다.

    라벨 JSON의 SamplingRate(전량 48000으로 기재)는 실제 파일과 불일치하므로
    (실측 결과 44100Hz가 다수) 샘플레이트를 지정하지 않고 ffmpeg가 파일에서 읽게 둔다.
    """
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", str(src),
         "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(dst)],
        check=True,
    )


def split_transcript(text: str) -> tuple[list[str], str]:
    """전사문을 발화 단위로 나눈다. 반환: (단위 리스트, 유형).

    데이터에는 두 유형이 섞여 있다.
      - 문장형: "휴지를 버려 주세요. 우체국은 병원 앞에 있어요." → 문장부호로 분할
      - 낱말형: "거울 안경 전화 신발 나무" → 문장부호가 없어 어절이 곧 발화 단위
    '그래*' 같은 정정 표기는 원문 그대로 두고 정렬 단계에서 처리한다.
    """
    text = text.strip()
    if not text:
        return [], "빈전사"
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    # 문장부호가 거의 없으면 낱말 나열로 본다 (단위당 평균 글자수로 판별)
    if len(sentences) <= 1 or (len(text) / len(sentences)) > 60:
        words = text.split()
        if len(words) > 20 and all(len(w) <= 6 for w in words[:20]):
            return words, "낱말형"
    return sentences, "문장형"


def vad_segments(wav16k: Path, model) -> list[tuple[float, float]]:
    """silero-VAD로 발화 구간 (시작초, 끝초) 목록을 얻는다."""
    from silero_vad import get_speech_timestamps

    audio, sr = sf.read(str(wav16k), dtype="float32")
    assert sr == 16000, f"16kHz 변환 실패: {sr}"
    ts = get_speech_timestamps(
        audio, model,
        sampling_rate=16000,
        return_seconds=True,
        # 구음장애 발화는 발성이 약하고 끊기므로 기본값보다 관대하게 잡는다.
        threshold=0.35,
        min_speech_duration_ms=250,
        min_silence_duration_ms=MIN_SILENCE_MS,
    )
    return [(t["start"], t["end"]) for t in ts]


def find_label(audio: Path, label_dir: Path, index: dict) -> Path | None:
    return index.get(audio.name)


def build_label_index(label_dir: Path) -> dict:
    """File_id(wav 파일명) → 라벨 경로 색인. 라벨과 원천의 디렉터리 구조가 달라 이름으로 잇는다."""
    index = {}
    for lp in label_dir.rglob("*.json"):
        try:
            obj = json.loads(lp.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        fid = obj.get("File_id") or (lp.stem + ".wav")
        index[fid] = lp
        index.setdefault(lp.stem + ".wav", lp)
    return index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio-dir", required=True)
    ap.add_argument("--label-dir", required=True)
    ap.add_argument("--limit", type=int, default=0, help="검사할 파일 수 (0=전부)")
    ap.add_argument("--dump-segments", help="세그먼트 타임스탬프를 JSON으로 저장 (본 세그먼트화에서 재사용)")
    args = ap.parse_args()

    from silero_vad import load_silero_vad

    audio_dir, label_dir = Path(args.audio_dir), Path(args.label_dir)
    wavs = sorted({p.name: p for p in audio_dir.rglob("*.wav")}.values())
    if args.limit:
        wavs = wavs[: args.limit]
    if not wavs:
        raise SystemExit(f"WAV을 찾지 못했습니다: {audio_dir}")

    index = build_label_index(label_dir)
    model = load_silero_vad()
    print(f"WAV {len(wavs)}개 / 라벨 색인 {len(index)}건\n")

    header = f"{'파일':34s} {'길이':>7s} {'유형':6s} {'VAD':>5s} {'전사':>5s} {'비율':>6s} {'30초초과':>7s} {'중앙길이':>7s}"
    print(header)
    print("-" * len(header))

    dump, ratios, over_counts = {}, [], []
    for wav in wavs:
        lp = find_label(wav, label_dir, index)
        if lp is None:
            print(f"{wav.name[:34]:34s}  라벨 없음 — 건너뜀")
            continue
        obj = json.loads(lp.read_text(encoding="utf-8-sig"))
        units, kind = split_transcript(obj.get("Transcript", ""))

        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td) / "16k.wav"
            to_16k_mono(wav, tmp)
            segs = vad_segments(tmp, model)

        segs = [(s, e) for s, e in segs if e - s >= MIN_SEG_SEC]
        durs = np.array([e - s for s, e in segs]) if segs else np.array([0.0])
        over = int((durs > WHISPER_MAX_SEC).sum())
        ratio = len(segs) / len(units) if units else 0.0
        total = sf.info(str(wav)).duration

        ratios.append(ratio)
        over_counts.append(over / max(len(segs), 1))
        dump[wav.name] = {"segments": segs, "units": units, "kind": kind, "label": str(lp)}

        print(f"{wav.name[:34]:34s} {total/60:6.1f}분 {kind:6s} {len(segs):5d} {len(units):5d} "
              f"{ratio:6.2f} {over:7d} {np.median(durs):6.1f}초")

    if ratios:
        print(f"\n[요약] VAD/전사 단위 비율 중앙값 {np.median(ratios):.2f} "
              f"(1.00에 가까울수록 1:1 매핑 가능)")
        print(f"       30초 초과 세그먼트 비율 평균 {np.mean(over_counts)*100:.1f}% "
              f"(높으면 재분할 필요)")
        print("\n판단 기준")
        print("  비율 ≈ 1.0  → 순차 1:1 매핑으로 바로 manifest 생성 가능")
        print("  비율 > 1.3  → 화자가 한 단위를 여러 번 끊어 말함 → 인접 세그먼트 병합 필요")
        print("  비율 < 0.8  → VAD가 여러 단위를 붙여 잡음 → 임계값 조정 또는 재분할 필요")

    if args.dump_segments:
        Path(args.dump_segments).write_text(
            json.dumps(dump, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\n세그먼트 덤프 → {args.dump_segments}")


if __name__ == "__main__":
    main()
