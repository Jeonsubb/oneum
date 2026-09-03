#!/usr/bin/env python3
"""발급받은 키가 우리 코드가 쓰는 엔드포인트에서 실제로 통하는지 확인한다.

    uv run python scripts/check_keys.py

Azure 포털의 메뉴 이름은 자주 바뀌므로 "어느 리소스를 만들어야 하나"를 화면으로 판단하기 어렵다.
판정 기준은 하나다 — 이 스크립트가 통과하면 그 키가 맞는 키다.
"""
import asyncio
import os
import re
import sys

import httpx
from dotenv import load_dotenv

load_dotenv()


async def check_azure() -> bool:
    # .env에 넣기 전에 바로 시험할 수 있게 인자도 받는다:
    #   uv run python scripts/check_keys.py <키> [지역]
    key = sys.argv[1] if len(sys.argv) > 1 else os.getenv("AZURE_SPEECH_KEY", "")
    region = (sys.argv[2] if len(sys.argv) > 2
              else os.getenv("AZURE_SPEECH_REGION", "koreacentral"))
    if not key:
        print("· Azure  건너뜀 — AZURE_SPEECH_KEY 없음 (mock 모드로 동작합니다)")
        return True
    # 토큰 발급 엔드포인트는 오디오 없이 키·지역 조합만 검증할 수 있어 점검에 알맞다.
    url = f"https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(url, headers={"Ocp-Apim-Subscription-Key": key})
    except httpx.HTTPError as e:
        print(f"✗ Azure  연결 실패: {e}")
        return False
    if r.status_code == 200:
        print(f"✓ Azure  키 유효 (지역 {region}) — 음성인식 사용 가능")
        return True
    if r.status_code == 401:
        print(f"✗ Azure  401 — 키가 틀렸거나 이 지역의 키가 아닙니다 (시도한 지역: {region})")
        print("         리소스의 '위치/지역'이 다를 수 있습니다. 다른 지역을 찾는 중…")
        for alt in ("koreacentral", "japaneast", "eastus", "westus", "westeurope",
                    "southeastasia", "koreasouth"):
            if alt == region:
                continue
            try:
                async with httpx.AsyncClient(timeout=8) as c2:
                    rr = await c2.post(
                        f"https://{alt}.api.cognitive.microsoft.com/sts/v1.0/issueToken",
                        headers={"Ocp-Apim-Subscription-Key": key})
                if rr.status_code == 200:
                    print(f"         → 이 키의 지역은 '{alt}' 입니다. "
                          f".env 의 AZURE_SPEECH_REGION 을 그렇게 바꾸세요")
                    return False
            except httpx.HTTPError:
                continue
        print("         어느 지역에서도 통하지 않습니다. Speech 리소스의 키가 맞는지 확인하세요")
    elif r.status_code == 403:
        print("✗ Azure  403 — 키는 맞지만 Speech 권한이 없습니다. "
              "'Speech service' 또는 'Azure AI services' 리소스의 키인지 확인하세요")
    else:
        print(f"✗ Azure  예상치 못한 응답 {r.status_code}: {r.text[:200]}")
    return False


async def check_llm() -> bool:
    provider = os.getenv("LLM_PROVIDER", "mock").lower()
    model = os.getenv("LLM_MODEL", "qwen3:8b")
    base = os.getenv("LLM_BASE_URL", "http://localhost:11434")
    if provider == "mock":
        print("· LLM    건너뜀 — LLM_PROVIDER=mock (등록 문장을 제안으로 돌려줍니다)")
        return True

    if provider == "ollama":
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.get(f"{base}/api/tags")
                r.raise_for_status()
                names = [m["name"] for m in r.json().get("models", [])]
        except httpx.HTTPError as e:
            print(f"✗ LLM    Ollama에 연결할 수 없습니다 ({base}): {e}")
            print("         `ollama serve` 가 떠 있는지 확인하세요")
            return False
        if not any(n == model or n.startswith(model.split(":")[0]) for n in names):
            print(f"✗ LLM    Ollama는 떠 있으나 모델 '{model}'이 없습니다. 받은 모델: {names or '없음'}")
            print(f"         `ollama pull {model}` 을 먼저 실행하세요")
            return False
        print(f"✓ LLM    Ollama 연결됨 — 모델 {model}")
        return True

    if provider == "gemini":
        key = os.getenv("LLM_API_KEY", "")
        if not key:
            print("✗ LLM    LLM_PROVIDER=gemini 인데 LLM_API_KEY가 없습니다")
            print("         https://aistudio.google.com 에서 무료 키를 발급하세요")
            return False
        # 모델 이름은 자주 바뀐다. 추측하지 말고 계정이 실제로 쓸 수 있는 목록을 물어본다.
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get("https://generativelanguage.googleapis.com/v1beta/models",
                                headers={"x-goog-api-key": key})
        except httpx.HTTPError as e:
            print(f"✗ LLM    Gemini 연결 실패: {e}")
            return False
        if r.status_code != 200:
            print(f"✗ LLM    Gemini {r.status_code} — 키가 틀렸습니다: {r.text[:200]}")
            return False
        # 목록에 있다고 쓸 수 있는 것은 아니다. 신규 계정에 막힌 모델도 목록에는 그대로 남는다
        # (실제로 gemini-2.5-flash 는 목록에 있으면서 호출하면
        #  404 "no longer available to new users" 를 돌려줬다).
        # 그래서 판정은 반드시 실제 generateContent 호출로 한다.
        listed = [m["name"].removeprefix("models/") for m in r.json().get("models", [])
                  if "generateContent" in m.get("supportedGenerationMethods", [])]

        async def probe(name):
            async with httpx.AsyncClient(timeout=25) as c:
                rr = await c.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{name}:generateContent",
                    headers={"x-goog-api-key": key},
                    json={"contents": [{"parts": [{"text": "ping"}]}]},
                )
            if rr.status_code == 200:
                return True, ""
            try:
                return False, rr.json()["error"]["message"]
            except Exception:
                return False, f"HTTP {rr.status_code}"

        ok, msg = await probe(model)
        if ok:
            print(f"✓ LLM    Gemini 사용 가능 — 모델 {model}")
            return True
        print(f"✗ LLM    모델 '{model}' 호출 실패: {msg[:150]}")
        # 오류 메시지가 대체 모델을 직접 알려주는 경우가 많다. 그것부터 시험한다.
        hint = re.search(r"models/([\w.\-]+)", msg or "")
        order = ([hint.group(1)] if hint else []) + [m for m in listed if m != model]
        print("         실제로 되는 모델을 찾는 중…")
        for name in order[:6]:
            good, _ = await probe(name)
            if good:
                print(f"         → .env 의 LLM_MODEL 을 '{name}' 으로 바꾸세요")
                return False
        print("         후보를 찾지 못했습니다. https://aistudio.google.com 에서 확인하세요")
        return False

    if provider == "anthropic" and not os.getenv("ANTHROPIC_API_KEY"):
        print("✗ LLM    LLM_PROVIDER=anthropic 인데 ANTHROPIC_API_KEY가 없습니다")
        return False

    print(f"· LLM    provider={provider}, model={model} — 실제 호출로만 확인 가능합니다")
    return True


async def main() -> int:
    print("온음 키 점검\n")
    results = [await check_azure(), await check_llm()]
    print()
    ok = all(results)
    print("전부 통과" if ok else "문제가 있습니다. 위 메시지를 확인하세요")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
