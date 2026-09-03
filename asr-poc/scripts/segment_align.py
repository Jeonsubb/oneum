"""롱폼 녹음 → 발화 단위 클립 + 학습 manifest 생성.

segment_probe.py 실측(보유 6파일): VAD 구간 수 / 전사 단위 수 비율 중앙값 1.02,
30초 초과 세그먼트 0%. 즉 VAD 분할만으로 Whisper 입력 길이 요건은 충족되나
파일별 비율이 0.67~1.33으로 흔들려 순차 1:1 매핑은 정렬이 통째로 어긋날 위험이 있다.

그래서 두 단계로 처리한다.
  1) DP 정렬 — 낭독이라 "발화 길이 ∝ 문장 글자수"가 성립하는 점을 이용해
     연속 세그먼트를 단위에 배정한다. 병합(한 문장을 끊어 읽음)·단위 건너뜀
     (안 읽고 넘어감)·세그먼트 폐기(기침·잡음)를 모두 허용한다.
  2) 상대 CER 검증(--verify) — 정렬된 단위의 CER이 인접 단위보다 낮은지 본다.
     구음장애 발화는 베이스 모델 CER 자체가 높으므로 절대값으로 거르면 정상 쌍까지
     날아간다. "이웃보다 잘 맞는가"라는 상대 기준이라야 정렬 오류만 골라낼 수 있다.

사용:
  uv run python scripts/segment_align.py --audio-dir data/raw/audio --label-dir data/raw/labels \\
      --clip-dir data/clips --outdir data
  ... --verify --verify-sample 200     # 정렬 품질 표본 검증
"""
import argparse
import json
import random
import re
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

import numpy as np
import soundfile as sf

WHISPER_MAX_SEC = 30.0
MIN_SEG_SEC = 0.4
# 구음장애 화자는 한 문장을 여러 번 끊어 읽는다. 400ms로는 문장 내부 휴지까지 잘라
# VAD 구간이 전사 단위의 3~4배까지 튀었다. 1200ms 실측에서 비율이 2.95→1.25로 안정되고
# 30초 초과 세그먼트는 여전히 0%였다.
MIN_SILENCE_MS = 1200
# 한 단위(문장)를 최대 몇 개의 연속 세그먼트로 끊어 읽었다고 볼 것인가.
# 1200ms 적용 후에도 심하게 끊어 읽는 화자는 비율 3.0까지 나오므로 여유를 둔다.
MAX_MERGE = 8
# 정렬 비용에서 "단위를 안 읽고 건너뜀" / "세그먼트를 잡음으로 버림"에 물리는 벌점(초 환산).
SKIP_UNIT_PENALTY = 2.5
DROP_SEG_PENALTY = 2.0


def to_16k_mono(src: Path, dst: Path) -> None:
    """ffmpeg 스트리밍 변환. 라벨의 SamplingRate 기재(전량 48000)는 실제와 다르므로
    입력 샘플레이트를 지정하지 않고 파일에서 읽게 둔다 (실측 44100Hz 다수)."""
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", str(src),
         "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(dst)],
        check=True,
    )


def split_transcript(text: str) -> tuple[list[str], str]:
    """전사문을 발화 단위로 분할. 문장형(문장부호 기준)과 낱말형(어절 기준)이 섞여 있다."""
    text = text.strip()
    if not text:
        return [], "빈전사"
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    if len(sentences) <= 1 or (len(text) / len(sentences)) > 60:
        words = text.split()
        if len(words) > 20 and all(len(w) <= 6 for w in words[:20]):
            return words, "낱말형"
    return sentences, "문장형"


def clean_unit(text: str) -> str:
    """정정 표기를 정리한다. 'A+B'는 재발화, '그래*'는 중단된 발화를 뜻한다."""
    text = text.replace("+", " ").replace("*", "")
    return re.sub(r"\s+", " ", text).strip()


def vad_segments(wav16k: Path, model) -> list[tuple[float, float]]:
    from silero_vad import get_speech_timestamps

    audio, sr = sf.read(str(wav16k), dtype="float32")
    assert sr == 16000, f"16kHz 변환 실패: {sr}"
    ts = get_speech_timestamps(
        audio, model,
        sampling_rate=16000, return_seconds=True,
        threshold=0.35, min_speech_duration_ms=250, min_silence_duration_ms=MIN_SILENCE_MS,
    )
    segs = [(t["start"], t["end"]) for t in ts]
    return [(s, e) for s, e in segs if e - s >= MIN_SEG_SEC]


def align(segs: list[tuple[float, float]], units: list[str]) -> list[tuple[int, int, int] | None]:
    """세그먼트열을 단위열에 정렬한다.

    반환: 단위별 (세그먼트 시작 index, 끝 index+1, 단위 index) 또는 None(미발화).
    비용은 "배정된 실제 발화 길이"와 "글자수로 추정한 기대 길이"의 절대 오차(초)다.
    """
    M, N = len(segs), len(units)
    if M == 0 or N == 0:
        return []

    dur = np.array([e - s for s, e in segs])
    cum = np.concatenate([[0.0], np.cumsum(dur)])
    chars = np.array([max(len(clean_unit(u)), 1) for u in units], dtype=float)
    # 이 화자의 초당 글자수 — 중증도에 따라 편차가 크므로 파일 단위로 추정한다.
    sec_per_char = dur.sum() / chars.sum()
    expect = chars * sec_per_char

    INF = float("inf")
    # dp[i][j] = 세그먼트 i개, 단위 j개를 소비했을 때의 최소 비용
    dp = np.full((M + 1, N + 1), INF)
    back: dict[tuple[int, int], tuple[int, int, int]] = {}
    dp[0][0] = 0.0

    for j in range(N + 1):
        for i in range(M + 1):
            cur = dp[i][j]
            if cur == INF:
                continue
            # 단위 j를 읽지 않고 건너뜀
            if j < N:
                cand = cur + SKIP_UNIT_PENALTY
                if cand < dp[i][j + 1]:
                    dp[i][j + 1] = cand
                    back[(i, j + 1)] = (i, j, 0)
            # 세그먼트 i를 잡음으로 폐기
            if i < M:
                cand = cur + DROP_SEG_PENALTY
                if cand < dp[i + 1][j]:
                    dp[i + 1][j] = cand
                    back[(i + 1, j)] = (i, j, -1)
            # 단위 j에 연속 세그먼트 k개를 배정
            if j < N:
                for k in range(1, MAX_MERGE + 1):
                    if i + k > M:
                        break
                    span = cum[i + k] - cum[i]
                    if span > WHISPER_MAX_SEC:
                        break
                    cand = cur + abs(span - expect[j])
                    if cand < dp[i + k][j + 1]:
                        dp[i + k][j + 1] = cand
                        back[(i + k, j + 1)] = (i, j, k)

    if dp[M][N] == INF:
        return []

    out: list[tuple[int, int, int] | None] = []
    i, j = M, N
    while (i, j) != (0, 0):
        pi, pj, k = back[(i, j)]
        if k > 0:
            out.append((pi, i, pj))
        elif k == 0:
            out.append(None)
        i, j = pi, pj
    out.reverse()
    return out


def build_label_index(label_dir: Path) -> dict:
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


def speaker_of(file_id: str) -> str:
    """파일명 ID-02-26-N-BDS-01-01-M-25-KK 에서 화자 이니셜(BDS)을 뽑는다.
    train/eval을 화자 단위로 갈라야 개인화 효과가 새지 않는다.

    이니셜만 쓰는 이유: 화자 분리의 위험은 비대칭이다. 서로 다른 두 사람을 한 화자로 묶으면
    둘 다 같은 쪽으로 가서 누출이 없지만, 같은 사람을 두 화자로 쪼개면 train과 eval에 갈려
    평가가 무효가 된다. 실제로 이니셜이 겹치는 71건 중 대부분은 지역 코드 뒤 숫자만 다른
    (KK / KK2) 같은 화자의 다른 세션으로 보이므로, 지역까지 키에 넣으면 오히려 누출이 생긴다.
    따라서 묶는 방향인 이니셜 기준을 택한다."""
    m = re.match(r"ID-\d+-\d+-\w+-([A-Z]{2,4})-", file_id)
    return m.group(1) if m else file_id[:12]


def process_file(wav: Path, lp: Path, clip_dir: Path, model) -> list[dict]:
    obj = json.loads(lp.read_text(encoding="utf-8-sig"))
    units, kind = split_transcript(obj.get("Transcript", ""))
    if not units:
        return []

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "16k.wav"
        to_16k_mono(wav, tmp)
        segs = vad_segments(tmp, model)
        if not segs:
            return []
        mapping = align(segs, units)
        audio, sr = sf.read(str(tmp), dtype="int16")

    speaker = speaker_of(wav.stem)
    out_dir = clip_dir / speaker
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    for m in mapping:
        if m is None:
            continue
        a, b, j = m
        text = clean_unit(units[j])
        if not text:
            continue
        start, end = segs[a][0], segs[b - 1][1]
        dur = end - start
        if dur < MIN_SEG_SEC or dur > WHISPER_MAX_SEC:
            continue
        clip = out_dir / f"{wav.stem}_{j:04d}.wav"
        sf.write(str(clip), audio[int(start * sr): int(end * sr)], sr, subtype="PCM_16")
        rows.append({
            "audio": str(clip.resolve()),
            "text": text,
            "speaker": speaker,
            "source": wav.name,
            "unit_index": j,
            "duration": round(dur, 2),
            "kind": kind,
            "disease": obj.get("Disease_info", {}).get("Subcategory1", "?"),
            "sex": obj.get("Patient_info", {}).get("Sex", "?"),
            "age": obj.get("Patient_info", {}).get("Age", "?"),
        })
    return rows


def verify(rows: list[dict], sample: int, seed: int) -> None:
    """정렬 품질을 두 각도로 검증한다.

    ① 길이 상관 — 클립 길이와 정답 글자수의 상관계수. ASR 없이 계산되므로 환각의 영향을 받지
       않는다. 정렬이 통째로 밀렸다면 상관이 무너진다.
    ② 상대 CER — 정렬된 단위의 CER이 이웃 단위보다 낮은지. 구음장애 발화는 베이스 모델의
       절대 CER이 원래 높아 절대값으로 거르면 정상 쌍까지 날아가므로 상대 기준을 쓴다.
       무작위로 찍으면 20%(후보 5개)가 나오므로 그보다 얼마나 높은지로 판단한다.

    환각 억제: 짧은 클립에 모델이 긴 헛소리를 뱉으면 어느 후보와도 CER이 비슷해져 신호가
    묻힌다. 정답 길이에 비례해 max_new_tokens를 제한해 비교 가능한 길이로 맞춘다.
    """
    import jiwer
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    by_source: dict[str, list[dict]] = {}
    for r in rows:
        by_source.setdefault(r["source"], []).append(r)
    for v in by_source.values():
        v.sort(key=lambda r: r["unit_index"])

    # ① 길이 상관 — 전수 계산 (비용 0)
    durs = np.array([r["duration"] for r in rows])
    chars = np.array([len(r["text"]) for r in rows], dtype=float)
    corr = float(np.corrcoef(durs, chars)[0, 1]) if len(rows) > 2 else float("nan")

    pool = [r for r in rows if r["duration"] <= 20]
    random.Random(seed).shuffle(pool)
    pool = pool[:sample]
    if not pool:
        print(f"\n[정렬 검증] 길이 상관 r={corr:.3f} / CER 표본 없음")
        return

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    processor = WhisperProcessor.from_pretrained("openai/whisper-small")
    model = WhisperForConditionalGeneration.from_pretrained("openai/whisper-small").to(device).eval()

    def norm(t: str) -> str:
        return re.sub(r"[^가-힣a-zA-Z0-9]", "", t)

    wins, ties, total_cer = 0, 0, 0.0
    for r in pool:
        audio, sr = sf.read(r["audio"], dtype="float32")
        feats = processor(audio, sampling_rate=sr, return_tensors="pt").input_features.to(device)
        cap = min(max(int(len(norm(r["text"])) * 1.5) + 8, 12), 200)
        with torch.no_grad():
            ids = model.generate(feats, language="ko", task="transcribe", max_new_tokens=cap)
        hyp = norm(processor.decode(ids[0], skip_special_tokens=True))

        peers = by_source[r["source"]]
        idx = next(i for i, p in enumerate(peers) if p["audio"] == r["audio"])
        cands = [peers[i] for i in range(max(0, idx - 2), min(len(peers), idx + 3))]
        cers = [(jiwer.cer(norm(c["text"]) or "_", hyp or "_"), c["unit_index"]) for c in cands]
        best_cer, best_idx = min(cers)
        own = next(c for c, u in cers if u == r["unit_index"])
        total_cer += own
        if best_idx == r["unit_index"]:
            wins += 1
        elif abs(best_cer - own) < 1e-6:
            ties += 1

    n = len(pool)
    chance = 100.0 / np.mean([len(range(max(0, i - 2), min(len(v), i + 3)))
                              for v in by_source.values() for i in range(len(v))])
    print(f"\n[정렬 검증]")
    print(f"  ① 길이 상관 r={corr:.3f} (전체 {len(rows)}클립, 1.0에 가까울수록 정렬 일관)")
    print(f"  ② 상대 CER 승률 {wins/n*100:.1f}% (동률 {ties/n*100:.1f}%, 무작위 기대값 {chance:.0f}%, 표본 {n}건)")
    print(f"     베이스 whisper-small 평균 CER {total_cer/n*100:.1f}% — 구음장애라 높은 것이 정상")
    print("  → 상관 r<0.5 또는 승률이 무작위 기대값에 근접하면 정렬이 어긋난 것이다")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio-dir", required=True)
    ap.add_argument("--label-dir", required=True)
    ap.add_argument("--clip-dir", default="data/clips")
    ap.add_argument("--outdir", default="data")
    ap.add_argument("--limit", type=int, default=0, help="처리할 원본 파일 수 (0=전부)")
    ap.add_argument("--eval-speakers", type=int, default=8, help="평가 전용으로 뺄 화자 수")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--verify", action="store_true", help="상대 CER로 정렬 품질 검증")
    ap.add_argument("--verify-sample", type=int, default=150)
    args = ap.parse_args()

    from silero_vad import load_silero_vad

    audio_dir, label_dir = Path(args.audio_dir), Path(args.label_dir)
    clip_dir, outdir = Path(args.clip_dir), Path(args.outdir)
    wavs = sorted({p.name: p for p in audio_dir.rglob("*.wav")}.values())
    if args.limit:
        wavs = wavs[: args.limit]
    if not wavs:
        raise SystemExit(f"WAV을 찾지 못했습니다: {audio_dir}")

    index = build_label_index(label_dir)
    model = load_silero_vad()
    print(f"원본 {len(wavs)}개 처리 시작 (라벨 색인 {len(index)}건)\n")

    rows, skipped = [], Counter()
    for n, wav in enumerate(wavs, 1):
        lp = index.get(wav.name)
        if lp is None:
            skipped["라벨없음"] += 1
            continue
        try:
            got = process_file(wav, lp, clip_dir, model)
        except Exception as exc:
            skipped[f"실패({type(exc).__name__})"] += 1
            print(f"  [{n}/{len(wavs)}] {wav.name} — 실패: {exc}")
            continue
        rows.extend(got)
        print(f"  [{n}/{len(wavs)}] {wav.name} → 클립 {len(got)}개 (누적 {len(rows)})")

    if not rows:
        raise SystemExit(f"생성된 클립이 없습니다. 제외 사유: {dict(skipped)}")

    durs = np.array([r["duration"] for r in rows])
    print(f"\n총 클립 {len(rows)}개 / {durs.sum()/3600:.1f}시간 "
          f"(중앙 {np.median(durs):.1f}초, 최대 {durs.max():.1f}초)")
    print(f"화자 {len(set(r['speaker'] for r in rows))}명 / 유형 {dict(Counter(r['kind'] for r in rows))}")
    if skipped:
        print(f"제외: {dict(skipped)}")

    # 화자 단위 분리 — 같은 화자가 양쪽에 있으면 개인 발화 패턴이 새어 평가가 무효가 된다
    speakers = sorted(set(r["speaker"] for r in rows))
    random.Random(args.seed).shuffle(speakers)
    n_eval = min(args.eval_speakers, max(1, len(speakers) // 5))
    eval_spk = set(speakers[:n_eval])
    train = [r for r in rows if r["speaker"] not in eval_spk]
    evals = [r for r in rows if r["speaker"] in eval_spk]

    outdir.mkdir(parents=True, exist_ok=True)
    for name, data in [("train", train), ("eval", evals)]:
        with (outdir / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for r in data:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\ntrain {len(train)}클립 / eval {len(evals)}클립 (평가 전용 화자 {sorted(eval_spk)})")
    print(f"→ {outdir}/train.jsonl, {outdir}/eval.jsonl")

    if args.verify:
        verify(rows, args.verify_sample, args.seed)


if __name__ == "__main__":
    main()
