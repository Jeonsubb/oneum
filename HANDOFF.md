# 온음(Oneum) 작업 인계 — 다음 세션용

> 다음 세션 시작 시 이 파일을 먼저 읽어라. 프로젝트는 `/Users/jeondonghun/d-tech-2026`.
> 공모전(제9회 D-Tech, 접수 마감 **2026-09-11**) Track1 출품작. 구음장애인 의사소통 보조 앱.

## 지금 상태 (한 줄)

**핵심 기능은 실기기에서 동작 확인됨.** 폰 마이크로 말하면 인식→후보→확정→TTS까지 돌고,
파인튜닝 whisper + Azure 2-소스 앙상블 + Gemini 복원이 붙어 있다. 앱 UI를 계속 다듬는 중.

## 구조

- `oneum/mobile` — React Native(Expo SDK 57) 앱. 메인. 상태 하나로 화면 전환(App.tsx).
- `oneum/backend` — FastAPI 프록시(8010). `ASR_PROVIDER=ensemble`(local+azure), `LLM_PROVIDER=gemini`.
- `asr-poc/serve.py` — 파인튜닝 whisper 추론 서버(8020, MPS). checkpoints/whisper-small-v4-e3.
- `oneum/run-demo.sh` — ASR·백엔드·Expo 한 번에 기동 + LAN IP 자동 반영.
- git: https://github.com/Jeonsubb/oneum (**private**), 최신 커밋 4346e55에 아래 UI 변경 전부 포함.

## AI 대화 연습 — 반실시간(턴 방식) 구현 완료 (2026-09-03)

**코드 완성. 실기기 검증만 남음.** 흐름: 사용자가 말함→멈춤→우리 ASR 전사(사용자 말풍선)
→ 백엔드 `/api/chat`가 상대역 한 마디 반환(AI 말풍선)→ expo-speech로 읽어 줌 → 반복. 스트리밍 없음.
- 백엔드 `oneum/backend/main.py`: `/api/chat`(ChatRequest: situation·scenario·history) + `CHAT_SYSTEM`
  프롬프트 + `parse_reply` + mock 응답(`MOCK_CHAT`, 키 없이 데모 가능). 기존 `PROVIDERS`(gemini) 재사용.
- 클라이언트 `lib/api.ts`: `chat()` 함수(타임아웃 15s, 실패 시 되묻는 문구).
- `screens/Practice.tsx`: `AiChatScreen`(말풍선·자동스크롤·마이크·AI대기표시) + `ChatScenario` 타입 +
  연습 홈에 "AI와 대화 연습" 섹션. `App.tsx`: `CHAT_SCENARIOS`(병원접수/카페주문/주민센터) +
  startChat·chatRecord·exitChat 배선, `aiChat` 화면.
- 검증됨: `npx tsc --noEmit` 통과, mock 모드 `/api/chat` 오프너+턴 진행 정상.
- **확정 게이트 없음이 의도**: 상대가 실제 사람이 아니라 연습 상대라 여기서 나온 말은 남에게 전달 안 됨.
  실사용(말하기 탭)과 화면·경로 분리로 DD-02 유지. Gemini Live 문서: https://ai.google.dev/gemini-api/docs/live
- **다음 업그레이드(선택)**: 풀 실시간(useAudioStream int16 16kHz PCM→WebSocket→24kHz 재생 큐).
- **실기기 확인거리**: 실제 Azure ASR로 전사가 대화에 자연스럽게 붙는지, Gemini 응답 지연(2~4초)
  체감, TTS(ko-KR)와 녹음 오디오 모드 충돌 없는지.

## 진행 중이던 작업 (TaskList 기준)

- [완료] 즐겨찾기 완전 제거 (탭 2개: 말하기·연습). "내 표현 등록·정리"는 연습 탭 안으로 이동, 삭제 기능 포함.
- [완료] 연습 두 갈래: **상황 연습**(병원·매장·일상·공공기관) + **읽기 연습**(시·뉴스·문단, 예시 초안).
  읽기는 빠른발화 등록 안 함(발성 연습). `PracticeSet.kind`로 구분.
- [완료] 전달 화면 "다른 말 하기" 버튼, 큰 글자 줄높이 1.45(받침 잘림 수정), 마이크 뒤 파란 그림자 제거, 상황 칩 확대(60/22).
- [완료] **#3 AI 대화 연습(반실시간)** — 위 섹션 참고. 코드 완성, 실기기 검증만 남음.
- [대기] **#4 녹음 파일 업로드로 개인 말투 학습** — 사용자가 올린 녹음 파일 → ASR 전사 → 개인 표현
  프로필에 등록해 재정렬 few-shot에 반영. 본인 음성이라 IRB 무관(BC-01 백업 경로와 정합). 미착수.
- [대기] **#5 전체 화면 PDF** — 기능 개편 끝나면 최종 화면으로 생성. (`온음-전체화면.pdf` 레이아웃은 됐고
  캡처만 재실행 필요.)

## ★ 함정·주의 (반드시 알고 시작)

1. **폰에 깔린 앱은 구버전.** 마지막 폰 Release 빌드 = 탭 3개(즐겨찾기 포함) 시점. 그 이후 UI 변경
   (즐겨찾기 제거·연습 두 갈래·그림자·칩·다른말하기)은 **폰·시뮬 미반영**. 다음 세션에서 재빌드+검증 필요.
2. **맥 LAN IP가 172.20.10.2로 바뀜.** `mobile/.env`엔 아직 옛 IP(211.104.245.28). 재빌드 전
   `run-demo.sh`가 자동 갱신하거나 수동 수정 필요. 안 하면 폰에서 "연결 안 됨".
3. **시뮬레이터 dev 빌드가 Metro를 못 잡아 "No script URL" 에러** → 시뮬 캡처·확인 불가.
   확인은 **폰 Release 빌드**로 해야 함. (`expo run:ios`는 Metro 주소를 넣지만 raw xcodebuild launch는 안 넣음.)
4. iOS 재빌드 명령: `cd oneum/mobile/ios && xcodebuild -workspace app.xcworkspace -scheme app
   -configuration Release -destination "id=00008140-000844513630401C" -allowProvisioningUpdates
   -derivedDataPath ./DerivedData` → `xcrun devicectl device install app --device 00008140-000844513630401C <app>`.
   기기 UDID=00008140-000844513630401C(전동훈의 iPhone), 팀=3YDAXKB6SA, 번들=com.jeonsubb.oneum.
5. **무료 서명이라 앱 7일 만료.** 심사 전날 재설치 필요.
6. **`expo-av` 절대 다시 추가 금지** — 빌드 깨짐. 오디오는 `expo-audio`만.
7. 검증 스크립트: `cd oneum/mobile && npx tsc --noEmit`, `npx tsx scripts/verify-quick.ts`(판정기 18케이스).

## 키 (backend/.env, git에 없음)

- Azure Speech: koreacentral, F0 무료. / Gemini: `gemini-3.6-flash`(2.5-flash는 신규계정 404).
- **두 키 다 채팅에 노출됐음 → 공모전 후 폐기·재발급 권장.**
- 검증: `cd oneum/backend && uv run python scripts/check_keys.py` (실호출로 판정).

## 코드 밖 남은 일 (마감 리스크 순)

1. **당사자 인터뷰** — 심사 '장애이해' 항목 생명줄. 아직 진행 기록 없음. 최우선.
2. 기획서 `[보완 필요]` 채우기(팀원 계기·별지) + Track1.docx 5쪽 이식. 별지에 "실기기 동작 프로토타입" 근거 추가 가능.
3. 데모 영상(병원 접수 시나리오) — 이제 실동작하므로 촬영 가능.
4. 안드로이드 APK(심사위원 기기 안드로이드면). eas.json·계정 준비됨.
5. 임계값 보정(게이트 0.75/0.35 등 전부 BC-04 임시값) — 당사자 검증 발화 확보 후.
