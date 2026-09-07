"""온음(Oneum) 백엔드 — 무상태 프록시.

역할: Azure 키 보호(STT/TTS 중계)만. 개인 프로필·교정 이력은 전부 클라이언트 기기 내 저장(QA-05).
AZURE_SPEECH_KEY 미설정 시 목(mock) 모드로 동작해 키 없이 전체 흐름을 시연할 수 있다.
"""
import asyncio
import html
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import tempfile

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()
AZURE_KEY = os.getenv("AZURE_SPEECH_KEY", "")
AZURE_REGION = os.getenv("AZURE_SPEECH_REGION", "koreacentral")
LOCAL_ASR_URL = os.getenv("LOCAL_ASR_URL", "http://localhost:8020")

# 음성인식 공급자.
#   mock   키 없이 흐름만 시연
#   azure  범용 STT. 구음장애 발화에서는 성능이 크게 떨어진다 (그것이 이 서비스의 출발점이다)
#   local  우리가 파인튜닝한 whisper (asr-poc/serve.py). in-domain CER 18.7%
# 값을 주지 않으면 Azure 키 유무로 추론한다 — 기존 .env를 쓰던 환경이 그대로 동작하도록.
ASR_PROVIDER = os.getenv("ASR_PROVIDER", "azure" if AZURE_KEY else "mock").lower()
MOCK = ASR_PROVIDER == "mock" or os.getenv("MOCK_ASR") == "1"

app = FastAPI(title="oneum-backend")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.get("/healthz")
def healthz():
    return {"ok": True, "mock": MOCK, "asr": ASR_PROVIDER, "llm": LLM_PROVIDER,
            "region": AZURE_REGION}


def to_wav16k(data: bytes) -> bytes:
    """임의 포맷(m4a 등) 오디오를 Azure가 요구하는 16kHz mono PCM WAV로 변환."""
    if data[:4] == b"RIFF":
        return data
    if not shutil.which("ffmpeg"):
        raise HTTPException(500, "ffmpeg가 필요합니다 (brew install ffmpeg)")
    with tempfile.NamedTemporaryFile(suffix=".m4a") as src, tempfile.NamedTemporaryFile(
        suffix=".wav"
    ) as dst:
        src.write(data)
        src.flush()
        r = subprocess.run(
            ["ffmpeg", "-y", "-i", src.name, "-ar", "16000", "-ac", "1", "-f", "wav", dst.name],
            capture_output=True,
        )
        if r.returncode != 0:
            raise HTTPException(400, "오디오 변환 실패")
        return Path(dst.name).read_bytes()


async def asr_local(wav: bytes) -> list[dict]:
    """우리가 파인튜닝한 whisper (asr-poc/serve.py). 정확도는 높지만 빔서치가 수렴해
    후보를 사실상 1개만 낸다 — 그래서 앙상블에서 '정확한 1순위' 역할을 맡는다."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{LOCAL_ASR_URL}/transcribe",
                              files={"audio": ("utterance.wav", wav, "audio/wav")})
    r.raise_for_status()
    return [{**c, "engine": "local"} for c in r.json().get("candidates", [])]


async def asr_azure(wav: bytes) -> list[dict]:
    """Azure AI Speech. format=detailed 로 NBest[].Confidence 를 함께 받는다.
    구음장애 발화 정확도는 낮지만 후보를 여러 개 주므로, 확정 게이트(SF-04)가
    요구하는 '후보 2~3개'를 만들어 내는 쪽은 이 엔진이다."""
    url = (f"https://{AZURE_REGION}.stt.speech.microsoft.com"
           "/speech/recognition/conversation/cognitiveservices/v1")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            url, params={"language": "ko-KR", "format": "detailed"},
            headers={"Ocp-Apim-Subscription-Key": AZURE_KEY,
                     "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
                     "Accept": "application/json"},
            content=wav)
    if r.status_code != 200:
        raise HTTPException(502, f"Azure STT 오류 {r.status_code}: {r.text[:200]}")
    j = r.json()
    if j.get("RecognitionStatus") != "Success":
        return []
    return [{"text": n.get("Display") or n.get("Lexical", ""),
             "confidence": n.get("Confidence", 0.0), "engine": "azure"}
            for n in j.get("NBest", [])]


def merge_candidates(groups: list[list[dict]]) -> list[dict]:
    """두 엔진의 후보를 합친다.

    같은 문장을 서로 다른 엔진이 독립적으로 내놓았다면 그만큼 신뢰할 만하므로 가산한다.
    가산폭은 보정 전 임시값이다(BC-04) — 당사자 검증 발화를 얻으면 다시 맞춘다.
    """
    merged: dict[str, dict] = {}
    for cands in groups:
        for c in cands:
            key = re.sub(r"[\s.,!?]", "", c.get("text", ""))
            if not key:
                continue
            cur = merged.get(key)
            if cur is None:
                merged[key] = {**c, "engines": [c["engine"]]}
                continue
            if c["engine"] not in cur["engines"]:
                cur["engines"].append(c["engine"])
                # 두 엔진이 일치 → 남은 불확실성의 절반을 메운다
                best = max(cur["confidence"], c["confidence"])
                cur["confidence"] = round(best + (1 - best) * 0.5, 4)
                # 표기는 정확도가 높은 로컬 모델 쪽을 쓴다
                if c["engine"] == "local":
                    cur["text"] = c["text"]
            else:
                cur["confidence"] = max(cur["confidence"], c["confidence"])
    out = sorted(merged.values(), key=lambda c: -c["confidence"])
    for c in out:
        c.pop("engine", None)
    return out[:5]


@app.post("/api/recognize")
async def recognize(audio: UploadFile = File(...)):
    """음성(m4a/wav)을 받아 후보 목록을 돌려준다.

    ensemble 모드는 두 엔진을 **동시에** 부른다. 순차 호출하면 지연이 합쳐져
    목표(발화 종료 후 3초)를 넘기기 때문이다. 한쪽이 실패해도 나머지로 진행한다.
    """
    data = await audio.read()
    if len(data) < 1000:
        raise HTTPException(400, "오디오가 너무 짧습니다")

    if MOCK:
        return {"status": "Success", "mock": True, "candidates": [
            {"text": "물 한 잔 주세요", "confidence": 0.62},
            {"text": "불 좀 꺼 주세요", "confidence": 0.31},
            {"text": "무릎이 아파요", "confidence": 0.22}]}

    wav = to_wav16k(data)

    if ASR_PROVIDER == "local":
        return {"status": "Success", "engine": "local",
                "candidates": await asr_local(wav)}

    if ASR_PROVIDER == "azure":
        return {"status": "Success", "engine": "azure",
                "candidates": await asr_azure(wav)}

    if ASR_PROVIDER == "ensemble":
        results = await asyncio.gather(asr_local(wav), asr_azure(wav),
                                       return_exceptions=True)
        groups, failed = [], []
        for name, res in zip(("local", "azure"), results):
            if isinstance(res, Exception):
                print(f"[recognize] {name} 실패: {type(res).__name__}: {res}")
                failed.append(name)
            else:
                groups.append(res)
        if not groups:
            raise HTTPException(502, "두 ASR 엔진 모두 실패했습니다")
        cands = merge_candidates(groups)
        return {"status": "Success" if cands else "NoMatch", "engine": "ensemble",
                "failed": failed, "candidates": cands}

    raise HTTPException(500, f"알 수 없는 ASR_PROVIDER: {ASR_PROVIDER}")


class TtsRequest(BaseModel):
    text: str


@app.post("/api/tts")
async def tts(req: TtsRequest):
    """확정 문장을 명료한 한국어 음성(mp3)으로 합성. 목 모드에선 503 → 프론트가 브라우저 합성으로 폴백."""
    if MOCK:
        raise HTTPException(503, "mock 모드 — 프론트 브라우저 합성 폴백 사용")
    ssml = (
        "<speak version='1.0' xml:lang='ko-KR'>"
        f"<voice name='ko-KR-SunHiNeural'>{html.escape(req.text)}</voice></speak>"
    )
    headers = {
        "Ocp-Apim-Subscription-Key": AZURE_KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"https://{AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1",
            headers=headers, content=ssml.encode(),
        )
    if r.status_code != 200:
        raise HTTPException(502, f"Azure TTS 오류 {r.status_code}")
    return Response(content=r.content, media_type="audio/mpeg")


# ── LLM 의도 복원 (SF-03 slow path) ──────────────────────────────────────────
# 저신뢰 인식에서만 호출된다. N-best + 개인 표현 + 교정 이력(few-shot)으로 의도 후보를
# 2~3개 복원한다. 생성 후보는 클라이언트에서 '제안' 라벨로 확정 게이트를 반드시 거친다 —
# AI가 만든 문장이 사용자 승인 없이 발화되는 일은 구조적으로 없다(DD-02).
#
# 공급자는 LLM_PROVIDER로 고른다. 특정 업체에 묶지 않은 이유는 두 가지다.
#   · 지금은 무료로 돌려야 하고, 본선에서는 품질 좋은 유료 모델로 갈아탈 수 있어야 한다
#   · openai_compat 하나로 Ollama·Groq·OpenRouter·LM Studio 등 대부분을 커버한다
#
#   mock          기본값. 키 없이 전체 흐름 시연
#   gemini        Google AI Studio 무료 티어. 키 하나만 있으면 되고 설치가 없다
#   ollama        로컬 실행. 무료·무제한이고 교정 이력이 기기 밖으로 나가지 않는다
#   openai_compat /v1/chat/completions 규격을 따르는 모든 서비스 (LLM_BASE_URL로 지정)
#   anthropic     Claude. ANTHROPIC_API_KEY 필요

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "mock").lower()
LLM_MODEL = os.getenv("LLM_MODEL", "qwen3:8b")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "12"))


class AsrCandidate(BaseModel):
    text: str
    confidence: float = 0.0


class CorrectionPair(BaseModel):
    asr: str
    confirmed: str


class RecoverRequest(BaseModel):
    candidates: list[AsrCandidate]
    phrases: list[str] = []
    corrections: list[CorrectionPair] = []
    situation: str = "일상"


RECOVER_SYSTEM = """당신은 구음장애인의 의사소통 보조 서비스에서 음성인식 복원을 담당한다.
구음장애 발화는 초성·중성·종성 일부가 어긋나게 인식된다 (예: "물 한 잔 주세요" → "무루 한 자 주세여").

음성인식 N-best 후보, 사용자가 등록한 자주 쓰는 문장, 과거 교정 이력(오인식→사용자가 확정한 문장)을
근거로 사용자가 실제로 말했을 법한 한국어 문장을 2~3개 복원하라.

규칙:
- 발음이 뭉개진 패턴을 고려해 N-best와 음운적으로 가까운 문장을 우선한다.
- 등록 문장·교정 이력과 닮았다면 그 문장을 그대로 쓴다. 새 문장을 지어내는 것은 최후 수단이다.
- 사용자의 의도를 확장·미화하지 않는다. 짧은 발화는 짧게 복원한다.
- 확신이 없으면 후보를 적게 내라. 무리한 추측 3개보다 그럴듯한 1개가 낫다.

반드시 아래 JSON만 출력한다. 설명·인사·코드펜스를 붙이지 않는다.
{"suggestions": ["문장1", "문장2"]}"""


def build_user_prompt(req: "RecoverRequest") -> str:
    nbest = "\n".join(f"- {c.text} (신뢰도 {c.confidence:.2f})" for c in req.candidates)
    phrases = "\n".join(f"- {p}" for p in req.phrases[:30]) or "(없음)"
    fewshot = "\n".join(f'- 오인식 "{c.asr}" → 확정 "{c.confirmed}"'
                        for c in req.corrections[:10]) or "(없음)"
    return (f"[상황] {req.situation}\n\n[음성인식 N-best]\n{nbest}\n\n"
            f"[사용자 등록 문장]\n{phrases}\n\n[과거 교정 이력]\n{fewshot}")


def parse_suggestions(raw: str) -> list[str]:
    """모델 출력에서 문장 목록을 뽑는다.

    작은 로컬 모델은 지시해도 코드펜스나 앞말을 붙이는 일이 잦다. 그때마다 후보가
    통째로 날아가면 slow path를 켠 의미가 없으므로, 본문에서 첫 JSON 객체를 찾아 쓴다.
    """
    if not raw:
        return []
    text = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    items = data.get("suggestions")
    if not isinstance(items, list):
        return []
    return [s.strip() for s in items if isinstance(s, str) and s.strip()][:3]


async def call_ollama(system: str, user: str) -> str:
    """로컬 Ollama. 서버가 안 떠 있으면 예외가 나고 호출부가 빈 목록으로 처리한다."""
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        r = await client.post(
            f"{LLM_BASE_URL}/api/chat",
            json={
                "model": LLM_MODEL,
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": user}],
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.2},
            },
        )
    r.raise_for_status()
    return r.json().get("message", {}).get("content", "")


async def call_gemini(system: str, user: str) -> str:
    """Google AI Studio 무료 티어. 모델 이름은 자주 바뀌므로 LLM_MODEL로 받는다
    (사용 가능한 이름은 scripts/check_keys.py가 계정에 직접 물어서 알려준다)."""
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{LLM_MODEL}:generateContent")
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        r = await client.post(
            url,
            headers={"x-goog-api-key": LLM_API_KEY},
            json={
                "system_instruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": user}]}],
                "generationConfig": {"temperature": 0.2,
                                     "responseMimeType": "application/json"},
            },
        )
    r.raise_for_status()
    cands = r.json().get("candidates", [])
    if not cands:                      # 안전 필터에 걸리면 candidates가 비어서 온다
        return ""
    parts = cands[0].get("content", {}).get("parts", [])
    # 추론형 모델(gemini-3.x)은 사고 과정을 별도 part로 섞어 보낸다. 이어붙이면 JSON이 깨진다.
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


async def call_openai_compat(system: str, user: str) -> str:
    """/v1/chat/completions 규격 (Groq·OpenRouter·LM Studio·기타 무료 티어)."""
    headers = {"Authorization": f"Bearer {LLM_API_KEY}"} if LLM_API_KEY else {}
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        r = await client.post(
            f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
            headers=headers,
            json={
                "model": LLM_MODEL,
                "messages": [{"role": "system", "content": system},
                             {"role": "user", "content": user}],
                "temperature": 0.2,
                "response_format": {"type": "json_object"},
            },
        )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


async def call_anthropic(system: str, user: str) -> str:
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY", ""))
    resp = await client.messages.create(
        model=os.getenv("LLM_MODEL_ANTHROPIC", "claude-opus-5"),
        max_tokens=1024,
        output_config={"effort": "low"},
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    if resp.stop_reason == "refusal":
        return ""
    return next((b.text for b in resp.content if b.type == "text"), "")


PROVIDERS = {
    "gemini": call_gemini,
    "ollama": call_ollama,
    "openai_compat": call_openai_compat,
    "anthropic": call_anthropic,
}


@app.post("/api/recover")
async def recover(req: RecoverRequest):
    """저신뢰 인식의 의도 후보를 LLM으로 복원한다.

    실패하면 빈 목록을 돌려준다. 클라이언트는 재정렬 결과만으로 진행하므로 대화가 끊기지 않는다.
    """
    if not req.candidates:
        return {"suggestions": []}

    if LLM_PROVIDER == "mock":
        # 키 없이 흐름을 시연하기 위한 목 응답: 상황이 맞는 등록 문장을 제안으로 돌려준다
        return {"suggestions": [p for p in req.phrases if p][:2] or ["물 한 잔 주세요"],
                "provider": "mock"}

    fn = PROVIDERS.get(LLM_PROVIDER)
    if fn is None:
        return {"suggestions": [], "error": f"알 수 없는 LLM_PROVIDER: {LLM_PROVIDER}"}

    try:
        raw = await fn(RECOVER_SYSTEM, build_user_prompt(req))
    except Exception as exc:
        # 복원은 부가 기능이다. 여기서 500을 내면 인식 전체가 실패한 것처럼 보인다.
        print(f"[recover] {LLM_PROVIDER} 호출 실패: {type(exc).__name__}: {exc}")
        return {"suggestions": [], "provider": LLM_PROVIDER, "error": "llm_unavailable"}

    return {"suggestions": parse_suggestions(raw), "provider": LLM_PROVIDER}


# ── AI 대화 연습 (반실시간 턴 방식) ──────────────────────────────────────────
# 연습 탭 전용이다. 실사용(말하기 탭)과 철저히 분리한다 — 여기서 AI가 만든 문장은
# 사용자의 발화로 상대에게 전달되지 않는다. AI는 어디까지나 '연습 상대'다(DD-02와 정합).
# 흐름: 사용자가 말함 → 우리 ASR로 전사 → 그 텍스트와 대화 이력을 여기로 보냄
#       → 상황에 맞는 상대역 응답 1턴을 받음 → 클라이언트가 화면에 띄우고 TTS로 읽어 줌.

CHAT_SYSTEM = """당신은 구음장애인의 말하기 연습을 돕는 대화 상대역이다.
주어진 상황에서 사용자가 만나는 상대(병원 접수처 직원, 카페 점원, 약사 등)를 자연스럽게 연기한다.

규칙:
- 한 번에 한두 문장으로 짧고 명료하게 말한다. 긴 설명을 늘어놓지 않는다.
- 쉬운 한국어를 쓴다. 어려운 낱말이나 외래어를 피한다.
- 사용자의 발음이나 문장을 지적하거나 고쳐 주지 않는다. 알아들은 대로 자연스럽게 대화를 이어간다.
- 사용자가 다음에 말할 거리를 자연스럽게 만들어 주는 질문이나 반응을 한다.
- 대화 이력이 비어 있으면, 당신이 먼저 그 상황에 맞게 상대역으로서 인사하고 대화를 연다.
- 사용자의 말이 잘 이해되지 않으면 되물어 준다("죄송해요, 한 번만 더 말씀해 주시겠어요?").
- 상황과 무관한 이야기로 새지 않는다. 연습이 끝날 때까지 그 상황 안에 머무른다.

반드시 아래 JSON만 출력한다. 설명·인사말 접두사·코드펜스를 붙이지 않는다.
{"reply": "상대역의 다음 한 마디"}"""


class ChatTurn(BaseModel):
    role: str          # 'user' | 'ai'
    text: str


class ChatRequest(BaseModel):
    situation: str = "일상"
    scenario: str = ""             # 상대역·상황 설명 (예: "병원 접수처 직원. 접수하러 온 사용자를 응대한다.")
    history: list[ChatTurn] = []    # 지금까지의 대화 (오래된 순)


def build_chat_prompt(req: "ChatRequest") -> str:
    if req.history:
        lines = "\n".join(
            f"{'사용자' if t.role == 'user' else '상대역'}: {t.text}" for t in req.history[-12:]
        )
        convo = f"[지금까지의 대화]\n{lines}\n\n상대역으로서 다음 한 마디를 말하라."
    else:
        convo = "[아직 대화가 시작되지 않았다]\n상대역으로서 먼저 인사하고 대화를 열어라."
    return f"[상황] {req.situation}\n[상대역] {req.scenario or '상황에 맞는 대화 상대'}\n\n{convo}"


def parse_reply(raw: str) -> str:
    """모델 출력에서 상대역의 한 마디를 뽑는다. JSON이 깨져 오면 본문을 그대로 쓴다."""
    if not raw:
        return ""
    text = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.MULTILINE).strip()
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(0))
            reply = data.get("reply")
            if isinstance(reply, str) and reply.strip():
                return reply.strip()
        except json.JSONDecodeError:
            pass
    return text[:200]


# 키 없이 흐름을 시연하기 위한 목 응답. 상황별로 그럴듯한 상대역 한 마디를 돌아가며 준다.
MOCK_CHAT = {
    "병원": ["안녕하세요, 어떻게 오셨어요?", "네, 성함이 어떻게 되세요?",
             "잠시만 기다려 주세요. 곧 안내해 드릴게요.", "많이 불편하셨겠어요. 접수 도와드릴게요."],
    "매장": ["어서 오세요, 무엇을 드릴까요?", "네, 사이즈는 어떤 걸로 하시겠어요?",
             "포장해 드릴까요, 드시고 가세요?", "결제는 카드로 하시겠어요?"],
    "공공기관": ["안녕하세요, 어떤 일로 오셨어요?", "네, 신분증 가지고 오셨을까요?",
                 "잠시만요, 서류 확인해 드릴게요.", "여기 창구에서 도와드리겠습니다."],
    "일상": ["안녕하세요, 오늘 어떠세요?", "네, 천천히 말씀하셔도 괜찮아요.",
             "그러셨군요. 더 하실 말씀 있으세요?", "잘 들었어요. 편하게 이야기해 주세요."],
}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """AI 대화 연습의 상대역 응답 1턴을 돌려준다. 실패하면 되묻는 안전 문구로 대체한다."""
    if LLM_PROVIDER == "mock":
        bank = MOCK_CHAT.get(req.situation, MOCK_CHAT["일상"])
        # 대화 이력 길이에 따라 다음 줄을 고른다 — 키 없이도 대화가 진행되는 느낌을 준다
        turn = len([t for t in req.history if t.role == "ai"])
        return {"reply": bank[turn % len(bank)], "provider": "mock"}

    fn = PROVIDERS.get(LLM_PROVIDER)
    if fn is None:
        return {"reply": "", "error": f"알 수 없는 LLM_PROVIDER: {LLM_PROVIDER}"}

    try:
        raw = await fn(CHAT_SYSTEM, build_chat_prompt(req))
    except Exception as exc:
        print(f"[chat] {LLM_PROVIDER} 호출 실패: {type(exc).__name__}: {exc}")
        # 대화가 끊기지 않도록 되묻는 문구로 잇는다
        return {"reply": "죄송해요, 잘 못 들었어요. 한 번만 더 말씀해 주시겠어요?",
                "provider": LLM_PROVIDER, "error": "llm_unavailable"}

    reply = parse_reply(raw)
    return {"reply": reply or "네, 계속 말씀해 주세요.", "provider": LLM_PROVIDER}
