"""파인튜닝 whisper 추론 서버 — `uv run uvicorn serve:app --port 8020`

온음 백엔드(8010)가 m4a를 16kHz WAV로 바꿔 여기로 넘기면, 우리가 학습시킨 모델이
후보 문장을 돌려준다. 학습 환경(torch·transformers)을 그대로 재사용하려고 별도 서비스로 뒀다.
온음 백엔드에 torch를 넣으면 배포가 2GB 넘게 무거워지고, 앱 서버가 죽으면 모델도 함께 죽는다.

빔서치로 상위 N개를 받아 N-best로 쓴다. Whisper는 원래 N-best를 주지 않지만,
온음의 후보 재정렬(SF-03)은 후보가 여러 개일수록 개인 표현과 맞출 여지가 커진다.
"""
import io
import os
import time
from contextlib import asynccontextmanager

import soundfile as sf
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from transformers import WhisperForConditionalGeneration, WhisperProcessor

# 실증 결과(results/실증결과-2026-08-23.md)에서 채택한 3에폭 체크포인트.
# in-domain CER 18.7% — 범용 whisper-small(42.9%) 대비 56% 개선.
MODEL_DIR = os.getenv("ASR_MODEL", "checkpoints/whisper-small-v4-e3")
NUM_BEAMS = int(os.getenv("ASR_BEAMS", "5"))
NUM_RETURN = int(os.getenv("ASR_NBEST", "3"))

state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 모델 적재는 수 초 걸린다. 요청마다 올리면 첫 발화가 타임아웃되므로 기동 시 한 번만 올린다.
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    t0 = time.time()
    state["processor"] = WhisperProcessor.from_pretrained(MODEL_DIR)
    model = WhisperForConditionalGeneration.from_pretrained(MODEL_DIR).to(device).eval()
    model.generation_config.language = "ko"
    model.generation_config.task = "transcribe"
    state["model"] = model
    state["device"] = device
    print(f"[asr] {MODEL_DIR} 적재 완료 ({device}, {time.time() - t0:.1f}초)")
    yield
    state.clear()


app = FastAPI(title="oneum-asr", lifespan=lifespan)


@app.get("/healthz")
def healthz():
    return {"ok": True, "model": MODEL_DIR, "device": state.get("device"),
            "beams": NUM_BEAMS, "nbest": NUM_RETURN}


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """16kHz mono WAV → 후보 문장 목록 (온음 /api/recognize 와 같은 형태)."""
    raw = await audio.read()
    try:
        wav, sr = sf.read(io.BytesIO(raw), dtype="float32")
    except Exception as exc:
        raise HTTPException(400, f"오디오를 읽지 못했습니다: {exc}")
    if wav.ndim > 1:
        wav = wav.mean(axis=1)          # 스테레오면 모노로 합친다
    if sr != 16000:
        raise HTTPException(400, f"16kHz가 필요합니다 (받은 값 {sr})")
    if len(wav) < 1600:                 # 0.1초 미만은 인식 대상이 아니다
        return {"status": "TooShort", "candidates": []}

    processor, model, device = state["processor"], state["model"], state["device"]
    feats = processor(wav, sampling_rate=16000, return_tensors="pt").input_features.to(
        device=device, dtype=model.dtype)

    t0 = time.time()
    with torch.no_grad():
        out = model.generate(
            feats, language="ko", task="transcribe",
            num_beams=NUM_BEAMS,
            num_return_sequences=min(NUM_RETURN, NUM_BEAMS),
            # 특정 화자에서 같은 구절을 반복하는 환각이 관측됐다(results/guard_test.log).
            # 학습을 건드리지 않고 생성 단계에서 막는다.
            repetition_penalty=1.15, no_repeat_ngram_size=3, max_new_tokens=120,
            output_scores=True, return_dict_in_generate=True,
        )
    elapsed = time.time() - t0

    texts = processor.batch_decode(out.sequences, skip_special_tokens=True)
    # sequences_scores는 길이 정규화된 로그확률이다. exp를 취하면 0~1 범위의
    # 신뢰도가 되어 온음의 재정렬 가중치(W_ASR_CONFIDENCE)에 그대로 쓸 수 있다.
    # 보정 전 값이므로 절대 수치로 해석하지 않는다(BC-04).
    scores = getattr(out, "sequences_scores", None)
    confs = [float(torch.exp(s)) for s in scores] if scores is not None else [0.5] * len(texts)

    seen, candidates = set(), []
    for text, conf in zip(texts, confs):
        t = text.strip()
        if not t or t in seen:          # 빔이 같은 문장을 여러 번 내놓는 일이 흔하다
            continue
        seen.add(t)
        candidates.append({"text": t, "confidence": round(min(max(conf, 0.0), 1.0), 4)})

    if not candidates:
        return {"status": "NoMatch", "candidates": []}
    return {"status": "Success", "candidates": candidates,
            "elapsed_sec": round(elapsed, 2), "model": MODEL_DIR}
