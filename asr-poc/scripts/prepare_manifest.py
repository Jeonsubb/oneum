"""AI Hub 구음장애 음성인식 데이터 → 학습용 manifest(jsonl) 변환.

알려진 구조 (AI Hub 데이터 소개 기준):
  - 원천데이터: WAV / 라벨링데이터: JSON, Training·Validation·Test 분류
  - 라벨 JSON: 발화 텍스트, 검사방법(단어/문장/문단/준자유/자유)
  - 화자 메타: 성별, 나이, 거주지, 질병타입, 장애등급

키 이름은 배포본마다 다를 수 있어 후보 키를 순회해 찾는다.
먼저 --inspect 로 실제 스키마를 확인한 뒤 필요하면 KEY_CANDIDATES를 보정할 것.

사용:
  uv run python scripts/prepare_manifest.py --root data/raw --inspect
  uv run python scripts/prepare_manifest.py --root data/raw --method 문장 --eval-speakers 3
"""
import argparse
import json
import random
from collections import Counter
from pathlib import Path

KEY_CANDIDATES = {
    "text": ["transcription", "text", "발화내용", "orgtext", "standard", "sentence", "prompt"],
    "speaker": ["speakerId", "speaker_id", "spkId", "화자ID", "recorderId", "id"],
    "method": ["testMethod", "test_method", "검사방법", "type", "category", "speechType"],
    "disease": ["diseaseType", "disease", "질병타입", "disorder"],
    "grade": ["disabilityGrade", "grade", "장애등급", "severity"],
}


def deep_find(obj, candidates):
    """중첩 dict/list에서 후보 키 중 처음 발견되는 스칼라 값을 반환."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in candidates and isinstance(v, (str, int, float)) and str(v).strip():
                return str(v).strip()
        for v in obj.values():
            found = deep_find(v, candidates)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = deep_find(v, candidates)
            if found is not None:
                return found
    return None


def find_audio(label_path: Path, root: Path) -> Path | None:
    """라벨 JSON에 대응하는 WAV를 찾는다 (동일 stem 우선, 경로 치환 폴백)."""
    stem = label_path.stem
    sibling = label_path.with_suffix(".wav")
    if sibling.exists():
        return sibling
    swapped = Path(str(label_path).replace("라벨링데이터", "원천데이터")).with_suffix(".wav")
    if swapped.exists():
        return swapped
    matches = list(root.rglob(f"{stem}.wav"))
    return matches[0] if matches else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="AI Hub 데이터 루트 (샘플 압축 해제 위치)")
    ap.add_argument("--inspect", action="store_true", help="스키마·분포만 출력하고 종료")
    ap.add_argument("--method", help="검사방법 필터 (예: 문장). 부분 일치")
    ap.add_argument("--eval-speakers", type=int, default=3, help="평가 전용으로 뺄 화자 수")
    ap.add_argument("--limit", type=int, default=0, help="최대 발화 수 (0=제한 없음)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--outdir", default="data")
    args = ap.parse_args()

    root = Path(args.root).expanduser()
    labels = sorted(root.rglob("*.json"))
    if not labels:
        raise SystemExit(f"라벨 JSON을 찾지 못했습니다: {root}")
    print(f"라벨 파일 {len(labels)}개 발견")

    if args.inspect:
        sample = json.loads(labels[0].read_text(encoding="utf-8-sig"))
        print(f"\n--- 첫 라벨 파일: {labels[0].relative_to(root)}")
        print(json.dumps(sample, ensure_ascii=False, indent=2)[:2500])
        print("\n--- 자동 추출 결과 (KEY_CANDIDATES 기준)")
        for field, cands in KEY_CANDIDATES.items():
            print(f"  {field:8s}: {deep_find(sample, set(cands))}")
        print(f"\n--- 대응 WAV: {find_audio(labels[0], root)}")
        return

    rows, skipped = [], Counter()
    for lp in labels:
        try:
            obj = json.loads(lp.read_text(encoding="utf-8-sig"))
        except Exception:
            skipped["json파싱실패"] += 1
            continue
        text = deep_find(obj, set(KEY_CANDIDATES["text"]))
        if not text:
            skipped["텍스트없음"] += 1
            continue
        method = deep_find(obj, set(KEY_CANDIDATES["method"])) or "?"
        if args.method and args.method not in method:
            skipped["검사방법필터"] += 1
            continue
        wav = find_audio(lp, root)
        if not wav:
            skipped["WAV없음"] += 1
            continue
        rows.append({
            "audio": str(wav.resolve()),
            "text": text,
            "speaker": deep_find(obj, set(KEY_CANDIDATES["speaker"])) or lp.parent.name,
            "method": method,
            "disease": deep_find(obj, set(KEY_CANDIDATES["disease"])) or "?",
            "grade": deep_find(obj, set(KEY_CANDIDATES["grade"])) or "?",
        })

    if not rows:
        raise SystemExit(f"사용 가능한 발화가 없습니다. 제외 사유: {dict(skipped)}")

    print(f"\n사용 가능 발화 {len(rows)}개 (제외: {dict(skipped) or '없음'})")
    print(f"화자 {len(set(r['speaker'] for r in rows))}명")
    print(f"검사방법 분포: {dict(Counter(r['method'] for r in rows))}")
    print(f"질병타입 분포: {dict(Counter(r['disease'] for r in rows))}")

    # 화자 단위 분리 — 동일 화자가 양쪽에 있으면 개인화 효과가 새어 평가가 무효가 된다
    speakers = sorted(set(r["speaker"] for r in rows))
    random.Random(args.seed).shuffle(speakers)
    n_eval = min(args.eval_speakers, max(1, len(speakers) // 4))
    eval_spk = set(speakers[:n_eval])
    train = [r for r in rows if r["speaker"] not in eval_spk]
    evals = [r for r in rows if r["speaker"] in eval_spk]
    if args.limit:
        train = train[: args.limit]

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    for name, data in [("train", train), ("eval", evals)]:
        with (outdir / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for r in data:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\ntrain {len(train)}발화 / eval {len(evals)}발화 (평가 전용 화자 {sorted(eval_spk)})")
    print(f"→ {outdir}/train.jsonl, {outdir}/eval.jsonl")


if __name__ == "__main__":
    main()
