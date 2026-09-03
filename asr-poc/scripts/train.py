"""Whisper 파인튜닝 (manifest 기반, MPS).

사용: uv run python scripts/train.py --train data/train.jsonl --eval data/eval.jsonl
기본은 whisper-small 전체 파인튜닝. --lora 를 주면 LoRA(PEFT)로 전환.

실측 처리량 2.0발화/초 기준 소요 시간:
  전체 31,000클립 1에폭 4.4시간 / 2에폭 8.7시간 / 3에폭 13.1시간
  --limit 12000 --epochs 2 → 3.3시간 (야간 1회로 가능)

화자별 클립 수는 편차가 크다(한 화자가 800클립 이상 차지). --balance-speakers 로
화자당 상한을 두면 특정 화자의 발화 습관에 과적합되는 것을 막을 수 있다.
"""
import json, argparse, random
from collections import Counter, defaultdict
from pathlib import Path
import torch
from torch.utils.data import Dataset
from transformers import (WhisperForConditionalGeneration, WhisperProcessor,
                          Seq2SeqTrainer, Seq2SeqTrainingArguments)
import soundfile as sf

def load_rows(path, limit=0, balance=False, seed=42, kind=None):
    rows = [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]
    if kind:
        # 낱말형은 모든 단위가 2~3글자라 길이 신호가 없어 DP 정렬이 밀린다
        # (실측 길이 상관 r=0.169 vs 문장형 0.650). 잘못 짝지어진 쌍은 학습 노이즈다.
        before = len(rows)
        rows = [r for r in rows if r.get("kind") == kind]
        print(f"유형 필터({kind}): {before} → {len(rows)}클립")
    rng = random.Random(seed)
    if balance:
        by_spk = defaultdict(list)
        for r in rows:
            by_spk[r.get("speaker", "?")].append(r)
        # 화자당 상한 = 목표 수 / 화자 수. limit이 없으면 중앙값을 상한으로 삼는다.
        counts = sorted(len(v) for v in by_spk.values())
        cap = (limit // len(by_spk)) if limit else counts[len(counts) // 2]
        picked = []
        for v in by_spk.values():
            rng.shuffle(v)
            picked.extend(v[:max(cap, 1)])
        rows = picked
        print(f"화자 균형 적용: {len(by_spk)}명 × 상한 {cap} → {len(rows)}클립")
    rng.shuffle(rows)
    if limit:
        rows = rows[:limit]
    spk = Counter(r.get("speaker", "?") for r in rows)
    print(f"{path}: {len(rows)}클립 / 화자 {len(spk)}명 "
          f"(최다 {spk.most_common(1)[0][1] if spk else 0}클립)")
    return rows

class ManifestDataset(Dataset):
    def __init__(self, rows, processor):
        self.rows = rows
        self.processor = processor

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        row = self.rows[i]
        audio, sr = sf.read(row["audio"], dtype="float32")
        assert sr == 16000, f"16kHz 필요, 실제 {sr}: {row['audio']}"
        feats = self.processor(audio, sampling_rate=sr, return_tensors="pt").input_features[0]
        labels = self.processor.tokenizer(row["text"]).input_ids
        return {"input_features": feats, "labels": labels}

def collate(batch, processor, decoder_start_token_id):
    """Whisper 라벨 처리에는 함정이 두 개 있다. 둘 다 학습은 정상으로 보이지만
    (loss가 잘 내려간다) 생성이 망가져 CER이 폭발한다. 실제로 693%를 관측했다.

    ① pad_token_id와 eos_token_id가 같은 id(50257)다. 값으로 마스킹하면 패딩뿐 아니라
       문장 끝 EOS까지 -100이 되어 모델이 '언제 끝내는지'를 배우지 못하고 끝없이 생성한다.
       attention_mask로 패딩만 골라야 EOS가 살아남는다.
    ② 토크나이저가 앞에 붙이는 <|startoftranscript|>를 Trainer가 shift_right로 다시 붙인다.
       그대로 두면 시작 토큰이 두 번 들어가 학습과 추론의 프롬프트 구조가 어긋난다.
    """
    feats = torch.stack([b["input_features"] for b in batch])
    lb = processor.tokenizer.pad([{"input_ids": b["labels"]} for b in batch], return_tensors="pt")
    labels = lb["input_ids"].masked_fill(lb["attention_mask"].ne(1), -100)
    if (labels[:, 0] == decoder_start_token_id).all():
        labels = labels[:, 1:]
    return {"input_features": feats, "labels": labels}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="openai/whisper-small")
    ap.add_argument("--train", required=True)
    ap.add_argument("--eval", required=True)
    ap.add_argument("--out", default="checkpoints/whisper-small-dysarthria")
    ap.add_argument("--lora", action="store_true")
    ap.add_argument("--epochs", type=float, default=3)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0, help="학습에 쓸 최대 클립 수 (0=전부)")
    ap.add_argument("--eval-limit", type=int, default=400, help="에폭마다 평가할 클립 수")
    ap.add_argument("--balance-speakers", action="store_true",
                    help="화자당 클립 수에 상한을 둬 다발화 화자 과적합을 막는다")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--kind", choices=["문장형", "낱말형"],
                    help="발화 유형 필터. 낱말형은 정렬 신뢰도가 낮아 문장형만 쓰는 것을 권장")
    args = ap.parse_args()

    processor = WhisperProcessor.from_pretrained(args.model, language="ko", task="transcribe")
    model = WhisperForConditionalGeneration.from_pretrained(args.model)
    model.generation_config.language = "ko"
    model.generation_config.task = "transcribe"
    # LoRA로 감싸면 config 접근 경로가 바뀌므로 미리 확보해 둔다.
    decoder_start_token_id = model.config.decoder_start_token_id

    if args.lora:
        from peft import LoraConfig, get_peft_model
        cfg = LoraConfig(r=16, lora_alpha=32, target_modules=["q_proj", "v_proj"], lora_dropout=0.05)
        model = get_peft_model(model, cfg)
        model.print_trainable_parameters()

    train_rows = load_rows(args.train, args.limit, args.balance_speakers, args.seed, args.kind)
    eval_rows = load_rows(args.eval, args.eval_limit, False, args.seed, args.kind)
    train_ds = ManifestDataset(train_rows, processor)
    eval_ds = ManifestDataset(eval_rows, processor)

    targs = Seq2SeqTrainingArguments(
        output_dir=args.out,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=2,
        learning_rate=1e-5 if not args.lora else 1e-4,
        num_train_epochs=args.epochs,
        warmup_steps=10,
        eval_strategy="epoch",
        save_strategy="epoch",
        # Trainer는 기본적으로 '마지막' 에폭을 최종 모델로 저장한다. 과적합이 시작된 뒤에도
        # 그 상태가 저장되므로, eval_loss가 가장 낮은 에폭을 자동 선택하게 한다.
        # 실측: v4는 4에폭에서 eval_loss가 0.1054→0.1079로 반등했고, 그 모델은 특정 화자에서
        # CER 55.1%에 반복 생성까지 났다. 3에폭 체크포인트는 같은 조건에서 23.5%였다.
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        save_total_limit=3,
        logging_steps=25,
        report_to=["tensorboard"],
        dataloader_num_workers=2,
        use_cpu=False,
    )
    trainer = Seq2SeqTrainer(
        model=model, args=targs,
        train_dataset=train_ds, eval_dataset=eval_ds,
        data_collator=lambda b: collate(b, processor, decoder_start_token_id),
    )
    trainer.train()
    trainer.save_model(args.out)
    processor.save_pretrained(args.out)

if __name__ == "__main__":
    main()
