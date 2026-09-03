# 구음장애 한국어 ASR PoC (D-Tech 2026)

목표: AI Hub 구음장애 음성인식 데이터(2021, 429GB 중 서브셋)로 Whisper를 파인튜닝해
"기본 모델 vs 파인튜닝" CER/WER 비교 수치를 만든다. 이 표가 기획서의 기술 실증.

## 순서
1. AI Hub 데이터 압축 해제 → `data/raw/` (Training 원천 89GB, Validation 원천 75GB)
2. `uv run python scripts/segment_probe.py --audio-dir data/raw/audio --label-dir data/raw/labels`
   — 롱폼 세그먼트화가 성립하는지 먼저 진단 (VAD 구간 수 대 전사 단위 수)
3. `uv run python scripts/segment_align.py --audio-dir data/raw/audio --label-dir data/raw/labels --verify`
   — 발화 단위 클립 생성 + 화자 분리 manifest. `--verify`로 정렬 품질 표본 검증
4. `uv run python scripts/train.py --train data/train.jsonl --eval data/eval.jsonl`
5. `uv run python scripts/eval_wer.py --manifest data/eval.jsonl --models openai/whisper-small checkpoints/whisper-small-dysarthria`

> `prepare_manifest.py`는 "파일 1개 = 발화 1개"를 전제해 작성했으나 실제 데이터가 롱폼이라
> 사용하지 않는다. 세그먼트화는 `segment_align.py`가 대체한다.

## 주의
- train/eval은 반드시 화자 단위 분리 (동일 화자 누출 시 수치 무효)
- 환경: uv + Python 3.12, torch MPS (M5 Pro 48GB에서 whisper-small 추론 2초/5초오디오 확인)

## 파이프라인 검증 완료 (2026-08-21)
공개 한국어 데이터(Zeroth-Korean)로 train→eval 전 구간 실행 검증. 학습 2.08발화/초,
실데이터 1만 발화×3에폭 ≈ 4시간 추정. transformers 5.x API 불일치 1건 발견·수정.
상세: `PIPELINE-검증-2026-08-21.md` — **검증 수치는 정상 발화 기준이며 구음장애 근거 아님**

## 세그먼트화 검증 (2026-08-22)

라벨은 파일 전체를 통짜로 전사하고(평균 25분, 최대 8.5시간) 발화 단위 타임스탬프가 없다.
Whisper는 30초 창·448토큰이 상한이라 그대로는 학습이 성립하지 않으므로 VAD 분할 후
전사문과 DP 정렬한다(`segment_align.py`).

### VAD 파라미터 결정
소수 표본(6파일)에서는 VAD 구간 수 / 전사 단위 수 비율이 1.02로 좋았으나 **전체 데이터에서
1.35(최대 4.16)로 튀었다.** 구음장애 화자가 한 문장을 여러 번 끊어 읽기 때문이다.
문장 내부 휴지까지 자르지 않도록 `min_silence_duration_ms`를 올려 해결했다.

| min_silence | 문제 파일 비율 | 정상 파일 | 30초 초과 |
|---|---|---|---|
| 400ms (초기) | 2.95 | 1.02 | 0% |
| 800ms | 1.73 | 1.00 | 0% |
| **1200ms (채택)** | **1.25** | **1.00** | **0%** |

`MAX_MERGE`는 4→8. 1200ms에서도 비율 3.0까지 나오는 화자가 있어 여유를 뒀다.

### 정렬 품질 (25파일 2,941클립 기준)

| 지표 | 값 | 해석 |
|---|---|---|
| 길이 상관 r | **0.757** | 클립 길이와 정답 글자수가 비례 — ASR 없이 계산되어 환각 무관 |
| 상대 CER 승률 | **65.0%** (동률 8.3%) | 무작위 기대값 20% 대비 3.25배 |
| 베이스 whisper-small CER | 55.7% | 구음장애 발화의 범용 모델 성능 |

- 검증은 절대 CER이 아니라 **상대 기준**을 쓴다. 구음장애 발화는 베이스 모델 CER이 원래
  높아 절대값으로 거르면 정상 쌍까지 폐기된다.
- 처음엔 CER이 272.9%로 나왔는데, 짧은 클립에 모델이 긴 헛소리를 뱉는 환각 때문이었다.
  정답 길이에 비례해 `max_new_tokens`를 제한하니 55.7%로 안정됐다.
- **위 수치는 표본 기준 예비값이며 기획서에 확정 근거로 인용 금지** (BC-04 표현 원칙).

### 처리·학습 소요 (M5 Pro 48GB, MPS 실측)

| 단계 | 실측 |
|---|---|
| 세그먼트화 | 실시간 대비 149배 → 260.7시간 원본을 약 105분에 처리 |
| 학습 | 2.0 발화/초 |
| 전체 클립(약 31,000개) 학습 | 1에폭 4.4시간 / 2에폭 8.7시간 / 3에폭 13.1시간 |
| `--limit 12000 --epochs 2` | 3.3시간 (야간 1회로 가능) |

화자별 클립 수 편차가 크므로(한 화자가 800클립 이상) `--balance-speakers`로 화자당 상한을
두는 것을 권한다. 특정 화자의 발화 습관에 과적합되는 것을 막는다.

### 데이터에서 확인된 함정
- 라벨 `Meta_info.SamplingRate`는 1,632건 전량 48000으로 기재되어 있으나 **실제 파일은
  44100Hz가 다수**다. 라벨을 믿고 리샘플하면 재생 속도가 어긋난 채 학습된다.
  전처리는 ffmpeg가 파일에서 직접 읽게 한다.
- 검사방법은 전량 `Read aloud scripts`(낭독)다. 서비스가 다루는 짧은 일상 발화와
  도메인 갭이 있으므로 기획서에 명시하거나 문장형 구간을 선별해 쓴다.
- 라벨 없는 원천 wav 3개가 있다(423개 중). 자동으로 건너뛴다.

## 데이터셋 구성 (2026-08-22 확정)

| manifest | 클립 | 화자 | 용도 |
|---|---|---|---|
| `data/train.jsonl` | 28,058 | 56명 | 학습 (Training 원천 423파일에서 생성) |
| `data/eval.jsonl` | 4,357 | 10명 | 학습 중 검증 (Training 내 held-out 화자) |
| `data/eval_holdout.jsonl` | 1,171 | 25명 | **최종 평가 (Validation 원천, 완전 독립)** |

세 세트의 화자는 서로 겹치지 않는다 (확인 완료).

### AI Hub 분할을 그대로 믿으면 안 된다
**Validation 라벨 화자 128명 중 7명이 Training 화자와 겹친다.** AI Hub의 Training/Validation
분할은 화자 단위가 아니라 파일 단위다. Validation을 그대로 평가셋으로 쓰면 학습에서 본 화자가
섞여 개인화 효과가 새고 수치가 부풀려진다. `extract_validation.py --exclude-from` 으로
학습 manifest의 화자를 읽어 제외해야 한다.

### 함정: zsh는 변수를 단어 분할하지 않는다
`--exclude-speakers $TRAIN_SPK` 로 화자 66명을 넘겼는데 **조용히 무시됐다.** bash와 달리 zsh는
`$VAR` 확장 시 word splitting을 하지 않아 목록 전체가 인자 하나가 된다. 에러도 나지 않아
평가셋에 학습 화자가 섞인 것을 나중에야 발견했다. 셸에 의존하지 않는 `--exclude-from`을 쓸 것.

## 최종 결과 (2026-08-24) — 모델 v4

**`checkpoints/whisper-small-v4-e3`** 가 최종 모델이다. 상세는 `results/실증결과-2026-08-23.md`.

| 모델 | in-domain CER | WER |
|---|---|---|
| whisper-small (범용) | 42.9% | 69.3% |
| v3 | 25.5% | 34.1% |
| **v4 (3에폭)** | **18.7%** | **28.6%** |

### 반복해서 확인된 교훈

**① loss와 생성 품질은 별개다.** CER 693% 사태 때 loss는 0.96→0.55로 정상이었고, v3의
eval_loss 59% 개선은 평가셋이 쉬워진 착시였다. **매번 실제 출력을 열어봐야 한다.**

**② 데이터 양보다 라벨 정확도가 결정적이다.** v3→v4는 클립 수가 같다(17,173 vs 17,268).
파일 단위 정렬 검증으로 27개 파일(2,277클립)을 걷어낸 것만으로 CER이 25.5%→18.7%로 개선됐다.

**③ 정렬 판정은 CER 절대값이 아니라 offset 대비로 해야 한다.** 구음장애가 심한 화자는 라벨이
제자리에 있어도 베이스 모델 CER이 70~80%다. 절대값으로 자르면 중증 화자가 통째로 빠져
모델이 경증에 편향된다. 정렬이 맞으면 해당 offset에서만 CER이 급락하므로 그 대비가 진짜 신호다.

**④ `load_best_model_at_end=True`는 선택이 아니다.** Trainer는 마지막 에폭을 저장한다.
v4의 4에폭 모델은 낯선 화자에서 CER 55.1%(3에폭은 23.5%)에 반복 생성까지 났는데,
in-domain에서는 0.3%p 차이라 지표만 보면 알아챌 수 없었다.

### 남은 과제
- 유형별 평가셋(`data/eval_type_*.jsonl`)에 파일 단위 정렬 검증 미적용. 라벨 오류가 남아
  v3·v4 모두 실제보다 나쁘게 측정된다 (유형 12 KJJ 화자 사례). `check_alignment.py` 적용 필요
- whisper-large-v3-turbo는 정렬 검증 평가셋에서 미측정 (이전 평가셋 기준 CER 29.5%)
