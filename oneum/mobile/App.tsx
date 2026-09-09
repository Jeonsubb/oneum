/** 온음 — 확정 전에는 침묵하는 의사소통 보조.
 *
 *  화면 구성은 하이파이 목업(UI MOCKUP v3)을 그대로 따른다. 상태 하나로 15개 화면을 오가며,
 *  어떤 경로로 들어와도 ⑥ 전달 화면으로 합류하고 막다른 화면을 만들지 않는다.
 *
 *  소리가 나는 지점은 단 두 곳뿐이다.
 *    · ⑥ 전달 화면의 [소리로 말하기] — 사용자가 확정하고 다시 한 번 누른다
 *    · ⑭′ 빠른 발화 재생 — 사전 승인(연습 검증 + 문장 단위 등록)을 마친 문장만,
 *      DD-05의 6조건 판정기를 전부 통과한 뒤 0.5초 미리보기를 거쳐서
 */
import './lib/font'   // 전역 서체 패치 — 반드시 다른 화면 import보다 먼저
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
// SDK 57에서 expo-av는 물러나고 expo-audio가 표준이다. 녹음기는 훅으로 얻는다.
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio'
import * as Speech from 'expo-speech'

import { chat, fetchEngineInfo, privacyNotice, recognize, recover, type ChatTurn, type EngineInfo } from './lib/api'
import { rerank, type RankedCandidate } from './lib/rerank'
import { similarity } from './lib/hangul'
import {
  addPhrase, loadConsent, loadCorrections, loadPhrases, recordCorrection, recordUse,
  removePhrase, saveConsent, type Correction, type Phrase, type Situation,
} from './lib/profile'
import {
  judgeQuick, loadQuick, loadQuickEvents, lockQuick, recordLiveConfirm, recordQuickEvent,
  registerQuick, type QuickEntry, type QuickEvent,
} from './lib/quick'
import { loadPrefs, savePrefs } from './lib/prefs'
import { playSfx } from './lib/sfx'
import { C, Btn, ScreenFade, TABBAR_CONTENT_HEIGHT, TabBar, layout, type TabKey } from './components/ui'
import {
  ConfirmChoiceScreen, ConfirmSureScreen, DeliverScreen, FailScreen, HomeScreen, ListeningScreen,
} from './screens/Core'
import { EditScreen, OnboardScreen } from './screens/Support'
import {
  AiChatScreen, ChatHomeScreen, ConsentScreen, PracticeHomeScreen, PracticeResultScreen,
  PracticeRunScreen, QuickHistoryScreen, QuickPlayingScreen, QuickPreviewScreen,
  type ChatScenario, type ConsentKey, type PracticeSet,
} from './screens/Practice'

/** 확정 게이트 임계값 — 재정렬 점수 기준. 보정 전 임시값이며 당사자 검증 발화로 재설정한다(BC-04). */
const GATE_SURE = 0.75   // 이 이상이면 ③ 확인 A(단일 후보)
const GATE_SHOW = 0.35   // 이 미만이면 ⑦ 실패
/** 연습 검증 통과 기준 — 자모 유사도. 정확 일치를 요구하면 조사·어미 차이로 좌절만 쌓인다. */
const PRACTICE_PASS = 0.85

type Screen =
  | 'home' | 'listening' | 'processing' | 'confirmSure' | 'confirmChoice' | 'edit' | 'deliver'
  | 'fail' | 'onboard' | 'consent' | 'practiceHome' | 'practiceRun' | 'practiceResult'
  | 'quickPreview' | 'quickPlaying' | 'quickHistory' | 'chatHome' | 'aiChat'

/** 언어재활사 자문 전 초안 세트(BC-08) — 문구는 자문 후 확정한다. */
const PRESETS: { text: string; situation: Situation }[] = [
  { text: '접수하러 왔어요', situation: '병원' },
  { text: '진료 예약을 바꾸고 싶어요', situation: '병원' },
  { text: '많이 아파요', situation: '병원' },
  { text: '수납은 어디서 하나요', situation: '병원' },
  { text: '이거 주세요', situation: '매장' },
  { text: '봉투 하나 주세요', situation: '매장' },
  { text: '카드로 결제할게요', situation: '매장' },
  { text: '천천히 말씀해 주세요', situation: '일상' },
  { text: '물 한 잔 주세요', situation: '일상' },
  { text: '조금만 기다려 주세요', situation: '일상' },
  { text: '민원 신청하러 왔어요', situation: '공공기관' },
  { text: '서류를 떼려고 해요', situation: '공공기관' },
]

// 상황 연습 세트 정의. total은 이 상황의 연습 문장 수, verified(등록 커버리지)는
// 실제 빠른 발화 등록 목록에서 계산한다 — 고정값이 아니다.
const PRACTICE_SET_DEFS: { name: string; situation: Situation }[] = [
  { name: '병원에서', situation: '병원' },
  { name: '매장에서', situation: '매장' },
  { name: '일상 인사', situation: '일상' },
  { name: '공공기관에서', situation: '공공기관' },
]

// 읽기 연습 지문 — 조음·발성 연습용. 문장 단위로 끊어 읽는다.
// 시는 저작권이 소멸한 김소월(1902~1934) 작품, 뉴스·문단은 직접 작성한 예시다.
// 최종 지문 구성은 언어재활사 자문으로 확정한다(BC-08) — 지금은 '초안'.
const READING_SETS: PracticeSet[] = [
  {
    name: '엄마야 누나야 (김소월 시)', kind: 'reading', total: 4, verified: 0, draft: true,
    sentences: ['엄마야 누나야 강변 살자', '뜰에는 반짝이는 금모래빛',
                '뒷문 밖에는 갈잎의 노래', '엄마야 누나야 강변 살자'],
  },
  {
    name: '뉴스 읽기', kind: 'reading', total: 3, verified: 0, draft: true,
    sentences: ['오늘 오전 서울 지역에 첫눈이 내렸습니다.',
                '기상청은 이번 추위가 주말까지 이어질 것으로 내다봤습니다.',
                '눈길 교통사고에 주의해 주시기 바랍니다.'],
  },
  {
    name: '아침 문단 읽기', kind: 'reading', total: 3, verified: 0, draft: true,
    sentences: ['아침에 일어나면 먼저 물을 한 잔 마십니다.',
                '창문을 열어 방 안 공기를 바꿉니다.',
                '천천히 몸을 움직이며 하루를 시작합니다.'],
  },
]

// AI 대화 연습 시나리오 — 상대역·상황을 백엔드 프롬프트로 넘긴다.
// 실사용(말하기 탭)과 분리된 '연습 상대'다. 여기서 나온 AI 문장은 남에게 전달되지 않는다(DD-02).
const CHAT_SCENARIOS: ChatScenario[] = [
  { name: '병원 접수처', situation: '병원',
    scenario: '병원 접수처 직원. 접수하러 온 사용자를 응대한다. 이름·증상·예약 여부를 차분히 묻는다.' },
  { name: '카페에서 주문', situation: '매장',
    scenario: '카페 점원. 음료를 주문하러 온 사용자를 응대한다. 메뉴·크기·포장 여부를 묻는다.' },
  { name: '주민센터 민원', situation: '공공기관',
    scenario: '주민센터 민원 창구 직원. 서류를 떼러 온 사용자를 응대한다. 필요한 서류와 신분 확인을 안내한다.' },
]

export default function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [situation, setSituation] = useState<Situation>('일상')
  const [candidates, setCandidates] = useState<RankedCandidate[]>([])
  const [confirmed, setConfirmed] = useState('')
  const [editSeed, setEditSeed] = useState('')
  const [retries, setRetries] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState('')

  const [phrases, setPhrases] = useState<Phrase[]>([])
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())

  // 빠른 발화는 기본 OFF (DD-05). 토글 상태는 재시작해도 유지된다(prefs).
  const [quickOn, setQuickOnState] = useState(false)
  // setter를 감싸 화면 상태와 저장을 한 번에 처리한다 — 앱을 껐다 켜도 선택이 남는다
  const setQuickOn = useCallback((v: boolean) => {
    setQuickOnState(v)
    savePrefs({ quickOn: v })
  }, [])
  const [quickEntries, setQuickEntries] = useState<QuickEntry[]>([])
  const [quickText, setQuickText] = useState('')
  // 실전 해금 경로(조건 2-b): 연속 3회 1순위 즉시 확정 → 전달 화면에서 등록을 '제안'한다
  const [quickSuggest, setQuickSuggest] = useState(false)
  const [consent, setConsent] = useState<Record<ConsentKey, boolean>>({ verify: true, adapt: false, research: false })
  // null이면 아직 동의를 묻지 않은 상태 — 연습에 처음 들어갈 때 ⑮ 동의 화면을 거친다(BC-07)
  const [consentAsked, setConsentAsked] = useState(false)
  // 어떤 엔진을 쓰는지에 따라 음성이 외부로 나가는지가 달라진다. 그 사실을 홈에 고지한다(QA-05).
  const [engine, setEngine] = useState<EngineInfo | null>(null)
  // 소리가 어느 기기로 나가는지 표기한다(QA-01). expo-audio가 출력 라우트를 노출하지
  // 않아 정확한 기기명은 못 얻지만, 재생 시작/종료로 상태만 갱신해 최소한 정직하게 둔다.
  const [outputDevice] = useState('이 휴대폰')

  // AI 대화 연습(반실시간) 상태
  const [chatScenario, setChatScenario] = useState<ChatScenario | null>(null)
  const [chatMsgs, setChatMsgs] = useState<ChatTurn[]>([])
  const [chatRec, setChatRec] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [chatNote, setChatNote] = useState('')

  const [quickEvents, setQuickEvents] = useState<QuickEvent[]>([])
  const [runSet, setRunSet] = useState<PracticeSet | null>(null)
  const [runIndex, setRunIndex] = useState(0)
  const [runRound, setRunRound] = useState<1 | 2 | 3>(1)
  const [runHeard, setRunHeard] = useState<string[]>([])
  const [practiceRec, setPracticeRec] = useState(false)

  // 레벨 측정(metering)을 켠다 — 듣는 중 화면의 파동이 목소리 크기에 실시간으로 반응한다
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true })
  const lastAsr = useRef('')

  useEffect(() => {
    loadPhrases().then(setPhrases)
    loadCorrections().then(setCorrections)
    loadQuick().then(setQuickEntries)
    fetchEngineInfo().then(setEngine)
    loadPrefs().then(p => setQuickOnState(p.quickOn))
    loadConsent().then(v => {
      if (v) { setConsent(v as Record<ConsentKey, boolean>); setConsentAsked(true) }
    })
  }, [])

  /* ── 녹음 → 인식 → 재정렬 → 빠른 발화 판정 → 게이트 분기 ── */
  const startRecording = useCallback(async () => {
    setError('')
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync()
      if (!perm.granted) { setError('마이크 권한이 필요해요'); return }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      // 효과음을 먼저 내고 준비하는 동안 잦아들게 한다 — 신호음이 녹음에 실리는 것을 줄인다
      playSfx('start')
      await recorder.prepareToRecordAsync()
      recorder.record()
      setScreen('listening')
    } catch {
      setError('녹음을 시작하지 못했어요')
    }
  }, [recorder])

  const stopRecording = useCallback(async () => {
    setScreen('processing')
    try {
      await recorder.stop()
      playSfx('stop')
      const uri = recorder.uri
      if (!uri) throw new Error('녹음 파일이 만들어지지 않았어요')

      const { candidates: asr } = await recognize(uri)
      lastAsr.current = asr[0]?.text ?? ''
      const ranked = rerank({ asrCandidates: asr, phrases, corrections, situation })

      // 빠른 발화 판정기 (SF-14) — 6조건 전부 충족 시에만 0.5초 미리보기로 진입.
      // 미충족이면 실패 문구 없이 일반 게이트로 자연 전환한다(강등 무표시).
      const verdict = judgeQuick({ ranked, situation, quickOn, entries: quickEntries, now: Date.now() })
      if (verdict.fire) {
        recordQuickEvent('fired', verdict.text)
        setQuickText(verdict.text)
        setScreen('quickPreview')
        return
      }
      if (quickOn && ranked[0]) recordQuickEvent('demoted', ranked[0].text)

      const top = ranked[0]
      // 확신해도 재생하지 않고 먼저 묻는다 — 확정 게이트가 유일한 출구다
      if (top && top.score >= GATE_SURE) { setCandidates(ranked); setScreen('confirmSure'); return }

      // 저신뢰 → LLM 복원 slow path (SF-03). 실패·지연 시 빈 목록이 돌아와 재정렬만으로 진행한다.
      // 복원 후보는 '제안' 라벨을 달고 게이트를 거친다 — 확정 없이는 절대 발화되지 않는다.
      const suggestions = await recover({
        candidates: asr,
        phrases: phrases.filter(p => p.situation === situation).map(p => p.text).slice(0, 30),
        corrections: corrections.slice(0, 10).map(c => ({ asr: c.asrText, confirmed: c.confirmedText })),
        situation,
      })
      const merged = [...ranked]
      for (const s of suggestions) {
        if (!merged.some(r => similarity(r.text, s) > 0.95)) {
          merged.push({ text: s, score: 0, source: 'llm' })
        }
      }
      setCandidates(merged)

      const showable = (top && top.score >= GATE_SHOW) || merged.some(m => m.source === 'llm')
      if (!showable) { setRetries(r => r + 1); setScreen('fail'); return }
      setScreen('confirmChoice')
    } catch (e) {
      // "못 알아들었다"와 "요청이 실패했다"는 다른 문제다. 오류 원인을 배너로 드러내야
      // 네트워크·권한 문제를 인식 실패로 오해하지 않는다.
      setError(`인식 요청 실패 — ${(e as Error).message}`)
      setRetries(r => r + 1)
      setScreen('fail')
    }
  }, [recorder, phrases, corrections, situation, quickOn, quickEntries])

  const cancelRecording = useCallback(async () => {
    try { await recorder.stop() } catch { /* 이미 멈춘 경우 무시 */ }
    setScreen('home')
  }, [recorder])

  /* ── 확정 → 전달 ─────────────────────────────────────────── */
  // topImmediate: ③ 확인 A에서 1순위를 그대로 확정했는가 — 실전 해금 경로(조건 2-b)의 재료
  const confirm = useCallback(async (text: string, topImmediate = false) => {
    playSfx('confirm')
    setConfirmed(text)
    setRetries(0)
    setQuickSuggest(false)
    if (lastAsr.current && lastAsr.current !== text) {
      // (오인식 → 확정) 쌍을 쌓아 다음 재정렬과 LLM few-shot에 반영한다 (SF-07)
      await recordCorrection(lastAsr.current, text)
      setCorrections(await loadCorrections())
    }
    setPhrases(await recordUse(text))
    // 같은 문장을 연속 3회 1순위 즉시 확정 → 시스템이 빠른 발화 등록을 '제안'한다.
    // 실전 발화 자체가 검증 데이터이므로 연습-실전 음향 불일치를 우회한다.
    const { suggest } = await recordLiveConfirm(text, topImmediate)
    setQuickSuggest(suggest)
    setScreen('deliver')
  }, [])

  const speak = useCallback(() => {
    setSpeaking(true)
    Speech.speak(confirmed, {
      language: 'ko-KR',
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    })
  }, [confirmed])

  const goHome = useCallback(() => {
    setScreen('home'); setCandidates([]); setConfirmed(''); setQuickSuggest(false)
  }, [])

  /* ── 연습 녹음 — 실제 인식 경로 (UC-06) ───────────────────── */
  const practiceSentence = useCallback(() => {
    if (!runSet || runSet.sentences.length === 0) return '물 한 잔 주세요'
    return runSet.sentences[runIndex % runSet.sentences.length]
  }, [runSet, runIndex])

  const practiceRecord = useCallback(async () => {
    const sentence = practiceSentence()
    if (!practiceRec) {
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync()
        if (!perm.granted) { setError('마이크 권한이 필요해요'); return }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        playSfx('start')
        await recorder.prepareToRecordAsync()
        recorder.record()
        setPracticeRec(true)
      } catch {
        setError('녹음을 시작하지 못했어요')
      }
      return
    }
    setPracticeRec(false)
    let heardText = ''
    try {
      await recorder.stop()
      playSfx('stop')
      const uri = recorder.uri
      if (uri) {
        const res = await recognize(uri)
        // 목 모드 백엔드는 고정 응답만 주므로 데모에서는 문장을 그대로 채운다.
        // Azure 키가 있으면 실제 인식 결과가 검증 데이터가 된다.
        heardText = res.mock ? sentence : (res.candidates[0]?.text ?? '')
      }
    } catch {
      // 인식 실패도 한 번의 시도로 기록한다 — 침묵보다 정직한 빈 결과가 낫다
    }
    const heard = [...runHeard, heardText]
    setRunHeard(heard)
    if (runRound < 3) setRunRound((runRound + 1) as 2 | 3)
    else setScreen('practiceResult')
  }, [practiceRec, practiceSentence, recorder, runHeard, runRound])

  /* ── AI 대화 연습 — 반실시간 턴 방식 (연습 탭 전용) ────────── */
  // 소리 내어 읽어 주는 공통 도우미. 새 말을 시작하기 전 이전 발화를 멈춘다.
  const speakKo = useCallback((text: string) => {
    Speech.stop()
    if (text) Speech.speak(text, { language: 'ko-KR' })
  }, [])

  const startChat = useCallback(async (s: ChatScenario) => {
    setChatScenario(s)
    setChatMsgs([])
    setChatNote('')
    setChatRec(false)
    setScreen('aiChat')
    setChatBusy(true)
    // 이력이 비어 있으면 AI가 상대역으로서 먼저 인사하며 대화를 연다
    const opener = await chat({ situation: s.situation, scenario: s.scenario, history: [] })
    setChatMsgs([{ role: 'ai', text: opener }])
    setChatBusy(false)
    speakKo(opener)
  }, [speakKo])

  const chatRecord = useCallback(async () => {
    if (chatBusy) return
    if (!chatRec) {
      setChatNote('')
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync()
        if (!perm.granted) { setChatNote('마이크 권한이 필요해요'); return }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
        Speech.stop()                       // AI가 말하는 중이면 멈추고 사용자 말을 듣는다
        playSfx('start')
        await recorder.prepareToRecordAsync()
        recorder.record()
        setChatRec(true)
      } catch {
        setChatNote('녹음을 시작하지 못했어요')
      }
      return
    }
    // 녹음을 멈추고 전사한다 — 확정 게이트 없이 바로 상대역에게 넘긴다(연습 상대이므로).
    setChatRec(false)
    let heard = ''
    try {
      await recorder.stop()
      playSfx('stop')
      const uri = recorder.uri
      if (uri) {
        const res = await recognize(uri)
        heard = res.candidates[0]?.text ?? ''
      }
    } catch {
      heard = ''
    }
    if (!heard) {
      setChatNote('잘 못 들었어요. 다시 한 번 눌러서 말해 주세요.')
      return
    }
    const history: ChatTurn[] = [...chatMsgs, { role: 'user', text: heard }]
    setChatMsgs(history)
    setChatNote('')
    setChatBusy(true)
    const reply = await chat({
      situation: chatScenario?.situation ?? '일상',
      scenario: chatScenario?.scenario ?? '',
      history,
    })
    setChatMsgs([...history, { role: 'ai', text: reply }])
    setChatBusy(false)
    speakKo(reply)
  }, [chatBusy, chatRec, recorder, chatMsgs, chatScenario, speakKo])

  const exitChat = useCallback(async () => {
    Speech.stop()
    if (chatRec) { try { await recorder.stop() } catch { /* 이미 멈춘 경우 무시 */ } }
    setChatRec(false)
    setChatBusy(false)
    setScreen('chatHome')
  }, [chatRec, recorder])

  /** 연습에서 다음 문장으로 넘어간다. 세트의 마지막 문장이었다면 연습 홈으로 돌아간다
   *  — 예전에는 끝없이 +1만 해서 "5/4 문장" 같은 표기가 나왔다. */
  const practiceAdvance = useCallback(() => {
    setRunRound(1)
    setRunHeard([])
    const count = runSet ? (runSet.sentences.length || runSet.total) : 0
    if (!runSet || runIndex + 1 >= count) { setScreen('practiceHome'); return }
    setRunIndex(runIndex + 1)
    setScreen('practiceRun')
  }, [runSet, runIndex])

  // 연습 세트 커버리지 실계산 — total은 그 상황의 연습 문장 수, verified는 실제 등록 수.
  // draft는 언어재활사 자문 전 초안 표기(BC-08).
  const situationSets: PracticeSet[] = PRACTICE_SET_DEFS.map(def => {
    const sentences = PRESETS.filter(p => p.situation === def.situation).map(p => p.text)
    const verified = quickEntries.filter(
      e => e.situation === def.situation && e.unlockPath === 'practice' && !e.locked,
    ).length
    return { name: def.name, kind: 'situation', situation: def.situation,
             sentences, total: sentences.length, verified, draft: true }
  })
  const practiceSets: PracticeSet[] = [...situationSets, ...READING_SETS]

  /* ── 하단 탭 ─────────────────────────────────────────────── */
  // 각 화면이 어느 탭에 속하는지. 여기 없는 화면(대화 흐름·진행 중)은 탭 바를 숨긴다.
  const TAB_OF: Partial<Record<Screen, TabKey>> = {
    home: 'home',
    // 내 표현 등록·연습·기록은 모두 '연습' 탭에 속한다
    onboard: 'practice', practiceHome: 'practice', consent: 'practice',
    practiceRun: 'practice', practiceResult: 'practice', quickHistory: 'practice',
    chatHome: 'chat', aiChat: 'chat',
  }
  // 탭 바는 각 탭의 '첫 화면'에서만 보인다. 하위(문장 등록·연습 진행)에서는 뒤로 버튼으로 돌아온다.
  const TAB_ROOT: Screen[] = ['home', 'practiceHome', 'chatHome']
  const activeTab = TAB_OF[screen]
  const showTabBar = TAB_ROOT.includes(screen)

  const goTab = (k: TabKey) => {
    if (k === 'home') setScreen('home')
    else if (k === 'chat') setScreen('chatHome')
    // 연습은 최초 진입 시 동의(BC-07)를 먼저 거친다
    else setScreen(consentAsked ? 'practiceHome' : 'consent')
  }

  /* ── 화면 라우팅 ─────────────────────────────────────────── */
  let content: React.ReactNode = null

  if (screen === 'home') {
    content = (
      <HomeScreen
        situation={situation} onSituation={setSituation}
        onMicDown={startRecording}
        quickOn={quickOn} onPauseQuick={() => setQuickOn(false)}
        notice={privacyNotice(engine)}
      />
    )
  } else if (screen === 'listening') {
    content = <ListeningScreen recorder={recorder} onStop={stopRecording} onCancel={cancelRecording} />
  } else if (screen === 'processing') {
    content = (
      <View style={[layout.body, st.center]}>
        <ActivityIndicator size="large" color={C.acc} />
        <Text style={st.processingTx}>알아듣는 중이에요…</Text>
      </View>
    )
  } else if (screen === 'confirmSure') {
    content = (
      <ConfirmSureScreen
        text={candidates[0]?.text ?? ''}
        onConfirm={() => confirm(candidates[0].text, true)}
        onSeeOthers={() => setScreen('confirmChoice')}
      />
    )
  } else if (screen === 'confirmChoice') {
    // LLM 복원 후보가 있으면 재정렬 상위 2 + 제안 순으로 최대 3개 (후보 2~3개 원칙)
    const llm = candidates.filter(c => c.source === 'llm')
    const base = candidates.filter(c => c.source !== 'llm').slice(0, llm.length ? 2 : 3)
    const shown = [...base, ...llm].slice(0, 3)
    content = (
      <ConfirmChoiceScreen
        candidates={shown.map(c => ({ text: c.text, suggested: c.source === 'llm' }))}
        onPick={t => confirm(t)}
        onEdit={t => { setEditSeed(t); setScreen('edit') }}
        onNone={() => { setRetries(r => r + 1); setScreen('fail') }}
      />
    )
  } else if (screen === 'edit') {
    content = <EditScreen initial={editSeed} onConfirm={t => confirm(t)} onBack={() => setScreen('confirmChoice')} />
  } else if (screen === 'deliver') {
    content = (
      <DeliverScreen
        text={confirmed} device={outputDevice} speaking={speaking}
        onSpeak={speak} onBack={goHome}
        onNext={() => { setConfirmed(''); setQuickSuggest(false); startRecording() }}
        quickSuggest={quickSuggest}
        onQuickAccept={async () => {
          const r = await registerQuick(confirmed, situation, 'live')
          setQuickEntries(r.entries)
          if (r.ok) setQuickOn(true)
          else setError(`이 문장은 안전을 위해 빠른 발화로 등록할 수 없어요 (${r.reason})`)
          setQuickSuggest(false)
        }}
        onQuickDismiss={() => setQuickSuggest(false)}
      />
    )
  } else if (screen === 'fail') {
    content = (
      <FailScreen
        retries={retries}
        onRetry={startRecording}
        onType={() => { setEditSeed(''); setScreen('edit') }}
      />
    )
  } else if (screen === 'onboard') {
    content = (
      <OnboardScreen
        presets={PRESETS} picked={picked}
        registered={phrases.map(p => ({ id: p.id, text: p.text, situation: p.situation }))}
        onRemove={async id => setPhrases(await removePhrase(id))}
        onToggle={async t => {
          const next = new Set(picked)
          if (next.has(t)) next.delete(t)
          else {
            next.add(t)
            const p = PRESETS.find(x => x.text === t)
            if (p) setPhrases(await addPhrase(p.text, p.situation))
          }
          setPicked(next)
        }}
        onAddCustom={async (t, s) => {
          setPhrases(await addPhrase(t, s))
          setPicked(new Set([...picked, t]))
        }}
        onDone={() => setScreen('practiceHome')}
        onBack={() => setScreen('practiceHome')}
      />
    )
  } else if (screen === 'consent') {
    content = (
      <ConsentScreen
        value={consent}
        onToggle={k => setConsent(c => ({ ...c, [k]: !c[k] }))}
        onDone={async () => {
          await saveConsent(consent)
          setConsentAsked(true)
          setScreen('practiceHome')
        }}
        onBack={goHome}
      />
    )
  } else if (screen === 'practiceHome') {
    content = (
      <PracticeHomeScreen
        sets={practiceSets}
        onStart={s => { setRunSet(s); setRunIndex(0); setRunRound(1); setRunHeard([]); setScreen('practiceRun') }}
        onHistory={async () => { setQuickEvents(await loadQuickEvents()); setScreen('quickHistory') }}
        onManage={() => setScreen('onboard')}
      />
    )
  } else if (screen === 'quickHistory') {
    content = <QuickHistoryScreen events={quickEvents} onBack={() => setScreen('practiceHome')} />
  } else if (screen === 'chatHome') {
    content = <ChatHomeScreen scenarios={CHAT_SCENARIOS} onStartChat={startChat} />
  } else if (screen === 'aiChat') {
    content = (
      <AiChatScreen
        title={chatScenario?.name ?? 'AI와 대화'}
        messages={chatMsgs}
        recording={chatRec}
        busy={chatBusy}
        note={chatNote}
        onRecord={chatRecord}
        onReplay={speakKo}
        onBack={exitChat}
      />
    )
  } else if (screen === 'practiceRun' && runSet) {
    content = (
      <PracticeRunScreen
        sentence={practiceSentence()} index={runIndex} total={runSet.total} round={runRound}
        recording={practiceRec}
        onRecord={practiceRecord}
        onSkip={practiceAdvance}
        onBack={() => { setPracticeRec(false); setScreen('practiceHome') }}
      />
    )
  } else if (screen === 'practiceResult' && runSet) {
    const sentence = practiceSentence()
    const matched = runHeard.map(h => similarity(h, sentence) >= PRACTICE_PASS)
    const passed = matched.filter(Boolean).length >= 3
    content = (
      <PracticeResultScreen
        sentence={sentence} heard={runHeard} matched={matched} passed={passed}
        canRegister={runSet.kind === 'situation'}
        onRegister={async () => {
          // 사전 승인은 자동이 아니라 사용자의 명시적 행동이다 (DD-05 조건 1).
          // 고위험 유형(금액·동의·거절·개인정보)은 등록 자체가 차단된다 (조건 6).
          const r = await registerQuick(sentence, runSet.situation as Situation, 'practice')
          setQuickEntries(r.entries)
          if (r.ok) {
            setQuickOn(true)
            // 조건 2-a: 연습 등록은 당일엔 게이트로만, 다음 날부터 즉시 발화된다. 이를 숨기지 않는다.
            setError('등록됐어요. 안전을 위해 내일부터 바로 말해집니다')
          } else {
            setError(`이 문장은 안전을 위해 빠른 발화로 등록할 수 없어요 (${r.reason})`)
          }
          practiceAdvance()
        }}
        onRetry={() => { setRunRound(1); setRunHeard([]); setScreen('practiceRun') }}
        onNext={practiceAdvance}
      />
    )
  } else if (screen === 'quickPreview') {
    // 소리가 나가기 전 마지막 0.5초의 침묵 — 취소하면 무음으로 게이트에 합류한다
    content = (
      <QuickPreviewScreen text={quickText}
        onFire={() => { setScreen('quickPlaying'); Speech.speak(quickText, { language: 'ko-KR' }) }}
        onCancel={() => {
          recordQuickEvent('demoted', quickText)
          setScreen(candidates.length ? 'confirmChoice' : 'home')
        }} />
    )
  } else if (screen === 'quickPlaying') {
    content = (
      <QuickPlayingScreen text={quickText}
        onUndo={async () => {
          // 오발화 → 전체 OFF가 아니라 해당 문장만 자동 잠금. 재검증(연습 재등록)으로만 풀린다 (SF-15)
          Speech.stop()
          recordQuickEvent('undone', quickText)
          setQuickEntries(await lockQuick(quickText))
        }}
        onDone={goHome} />
    )
  }

  return (
    <SafeAreaProvider>
      {/* 하단 세이프에어리어는 탭바(블러 재질)가 직접 처리한다 — 탭바가 화면 맨 아래까지 내려간다 */}
      <SafeAreaView style={layout.screen} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        {error ? (
          <View style={st.errorBar}>
            <Text style={st.errorTx}>{error}</Text>
            <Btn label="닫기" variant="outline" onPress={() => setError('')} style={{ width: 96, minHeight: 48 }} />
          </View>
        ) : null}
        {/* 탭바가 absolute로 떠 있으므로, 탭바 있는 화면은 그 높이만큼 여백을 확보한다 */}
        <View style={{ flex: 1, paddingBottom: showTabBar ? TABBAR_CONTENT_HEIGHT : 0 }}>
          <ScreenFade id={screen}>{content}</ScreenFade>
        </View>
        {showTabBar && activeTab && <TabBar active={activeTab} onSelect={goTab} />}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const st = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 20 },
  processingTx: { fontSize: 20, fontWeight: '700', color: C.sub },
  errorBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 24, marginTop: 8, padding: 14,
    backgroundColor: C.warnBg, borderRadius: 14, borderWidth: 2, borderColor: C.warn,
  },
  errorTx: { flex: 1, fontSize: 16, fontWeight: '700', color: C.warn },
})
