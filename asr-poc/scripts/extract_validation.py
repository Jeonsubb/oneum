"""Validation 원천 zip에서 평가에 필요한 화자 파일만 선택 추출.

Validation 원천은 75GB(압축 해제 시 약 225GB)라 전부 풀 이유가 없다. 평가에 필요한 것은
학습에 쓰지 않은 화자(held-out)의 발화이며, CER/WER은 클립 수백 개면 안정적으로 수렴한다.
화자 단위로 골라 필요한 wav만 뽑는다.

zip 내부 디렉터리명은 CP949로 인코딩되어 깨져 보이지만 wav 파일명 자체는 ASCII이므로
basename으로 매칭한다.

사용:
  # 무엇이 뽑힐지 먼저 확인
  uv run python scripts/extract_validation.py --zip <VS01.zip> --label-dir data/raw/labels/val --dry-run
  # 실제 추출
  uv run python scripts/extract_validation.py --zip <VS01.zip> --label-dir data/raw/labels/val \\
      --out data/raw/audio_val --speakers 25
"""
import argparse
import json
import random
import re
import zipfile
from collections import defaultdict
from pathlib import Path


def speaker_of(file_id: str) -> str:
    m = re.match(r"ID-\d+-\d+-\w+-([A-Z]{2,4})-", file_id)
    return m.group(1) if m else file_id[:12]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True, help="VS01_뇌신경장애.zip 경로")
    ap.add_argument("--label-dir", required=True, help="Validation 라벨 디렉터리")
    ap.add_argument("--out", default="data/raw/audio_val")
    ap.add_argument("--speakers", type=int, default=25, help="추출할 화자 수")
    ap.add_argument("--per-speaker", type=int, default=2, help="화자당 최대 파일 수")
    ap.add_argument("--max-minutes", type=float, default=40.0,
                    help="이보다 긴 녹음은 제외 (평가에 불필요하게 무겁다)")
    ap.add_argument("--exclude-speakers", nargs="*", default=[],
                    help="학습에 쓴 화자 — 평가에서 반드시 빼야 한다")
    ap.add_argument("--exclude-from", nargs="*", default=[],
                    help="manifest(jsonl)에서 speaker를 읽어 제외. 셸의 단어 분할에 의존하지 "
                         "않으므로 이쪽을 권장한다 (zsh는 $VAR를 분할하지 않아 목록이 통째로 "
                         "인자 하나가 되어 조용히 무시된다)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    exclude = set(args.exclude_speakers)
    for mf in args.exclude_from:
        for line in Path(mf).read_text(encoding="utf-8").splitlines():
            if line.strip():
                exclude.add(json.loads(line).get("speaker", ""))
    print(f"제외 화자 {len(exclude)}명")

    # 라벨에서 후보를 고른다 (재생시간·화자를 알 수 있으므로)
    by_spk: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for lp in Path(args.label_dir).rglob("*.json"):
        try:
            obj = json.loads(lp.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        fid = obj.get("File_id") or (lp.stem + ".wav")
        mins = (obj.get("playTime") or 0) / 60
        if mins <= 0 or mins > args.max_minutes:
            continue
        spk = speaker_of(fid)
        if spk in exclude:
            continue
        by_spk[spk].append((fid, mins))

    if not by_spk:
        raise SystemExit("조건에 맞는 화자가 없습니다. --max-minutes 를 늘려보세요.")

    rng = random.Random(args.seed)
    speakers = sorted(by_spk)
    rng.shuffle(speakers)
    speakers = speakers[: args.speakers]

    wanted: dict[str, str] = {}   # wav 파일명 → 화자
    total_min = 0.0
    for spk in speakers:
        files = sorted(by_spk[spk], key=lambda x: x[1])  # 짧은 것부터
        for fid, mins in files[: args.per_speaker]:
            wanted[fid] = spk
            total_min += mins

    print(f"선택: 화자 {len(speakers)}명 / 파일 {len(wanted)}개 / 총 {total_min/60:.1f}시간")
    if args.dry_run:
        for fid, spk in sorted(wanted.items())[:15]:
            print(f"  {spk}  {fid}")
        if len(wanted) > 15:
            print(f"  ... 외 {len(wanted)-15}개")
        return

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    found = 0
    with zipfile.ZipFile(args.zip) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name
            if name not in wanted:
                continue
            dst = out / wanted[name] / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            if dst.exists() and dst.stat().st_size == info.file_size:
                found += 1
                continue
            with zf.open(info) as src, dst.open("wb") as f:
                while chunk := src.read(1 << 20):
                    f.write(chunk)
            found += 1
            print(f"  [{found}/{len(wanted)}] {name}", flush=True)

    print(f"\n추출 완료: {found}개 → {out}")
    missing = len(wanted) - found
    if missing:
        print(f"주의: {missing}개는 zip에서 찾지 못했습니다 (라벨만 있고 원천이 없는 경우)")


if __name__ == "__main__":
    main()
