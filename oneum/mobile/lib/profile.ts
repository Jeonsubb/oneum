// 개인 표현 프로필 — 전부 기기 내 저장 (QA-05: 프로필·교정 이력은 서버로 나가지 않는다)
import AsyncStorage from '@react-native-async-storage/async-storage'

// 목업(UI MOCKUP v3)의 상황 칩과 일치시킨다. 자동 추정하지 않고 사용자가 직접 고른다(DD-06).
export type Situation = '일상' | '병원' | '매장' | '공공기관'
export const SITUATIONS: Situation[] = ['일상', '병원', '매장', '공공기관']

export interface Phrase {
  id: string
  text: string
  situation: Situation
  useCount: number
}

/** (오인식 텍스트 → 사용자가 확정한 문장) 쌍. 다음 재정렬의 가중치이자 LLM few-shot 재료(SF-07) */
export interface Correction {
  asrText: string
  confirmedText: string
  at: number
}

const PHRASE_KEY = 'oneum.phrases.v1'
const CORRECTION_KEY = 'oneum.corrections.v1'
const MAX_CORRECTIONS = 200

// 초기 문장 — 언어재활사 자문 전 임시 세트 (BC-08: 최종 구성은 재활사 자문으로 확정)
const SEED: Array<[string, Situation]> = [
  ['물 한 잔 주세요', '일상'],
  ['천천히 말씀해 주세요', '일상'],
  ['화장실이 어디예요?', '일상'],
  ['다시 한번 말해 주세요', '일상'],
  ['접수하러 왔어요', '병원'],
  ['예약했어요', '병원'],
  ['어디가 아픈지 설명할게요', '병원'],
  ['진료 시간이 언제예요?', '병원'],
  ['이거 주세요', '매장'],
  ['얼마예요?', '매장'],
  ['카드로 결제할게요', '매장'],
  ['봉투 주세요', '매장'],
]

function newId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export async function loadPhrases(): Promise<Phrase[]> {
  const raw = await AsyncStorage.getItem(PHRASE_KEY)
  if (raw) return JSON.parse(raw)
  const seeded: Phrase[] = SEED.map(([text, situation]) => ({
    id: newId(),
    text,
    situation,
    useCount: 0,
  }))
  await AsyncStorage.setItem(PHRASE_KEY, JSON.stringify(seeded))
  return seeded
}

export async function savePhrases(phrases: Phrase[]): Promise<void> {
  await AsyncStorage.setItem(PHRASE_KEY, JSON.stringify(phrases))
}

export async function addPhrase(text: string, situation: Situation): Promise<Phrase[]> {
  const phrases = await loadPhrases()
  const trimmed = text.trim()
  if (!trimmed || phrases.some((p) => p.text === trimmed && p.situation === situation)) {
    return phrases
  }
  const next = [...phrases, { id: newId(), text: trimmed, situation, useCount: 0 }]
  await savePhrases(next)
  return next
}

export async function removePhrase(id: string): Promise<Phrase[]> {
  const next = (await loadPhrases()).filter((p) => p.id !== id)
  await savePhrases(next)
  return next
}

export async function recordUse(text: string): Promise<Phrase[]> {
  const next = (await loadPhrases()).map((p) =>
    p.text === text ? { ...p, useCount: p.useCount + 1 } : p,
  )
  await savePhrases(next)
  return next
}

export async function loadCorrections(): Promise<Correction[]> {
  const raw = await AsyncStorage.getItem(CORRECTION_KEY)
  return raw ? JSON.parse(raw) : []
}

/** 오인식된 ASR 텍스트와 사용자가 실제로 확정한 문장이 다를 때만 기록한다. */
export async function recordCorrection(asrText: string, confirmedText: string): Promise<void> {
  if (!asrText || asrText === confirmedText) return
  const prev = await loadCorrections()
  const next = [{ asrText, confirmedText, at: Date.now() }, ...prev].slice(0, MAX_CORRECTIONS)
  await AsyncStorage.setItem(CORRECTION_KEY, JSON.stringify(next))
}

/** 연습 녹음 동의 (BC-07) — 기기 내 검증·적응 학습·연구 보관을 각각 따로 묻는다.
 *  null이면 아직 한 번도 묻지 않은 상태다. 연습 진입 전 최초 1회만 화면을 띄운다. */
const CONSENT_KEY = 'oneum.consent.v1'

export async function loadConsent(): Promise<Record<string, boolean> | null> {
  const raw = await AsyncStorage.getItem(CONSENT_KEY)
  return raw ? JSON.parse(raw) : null
}

export async function saveConsent(value: Record<string, boolean>): Promise<void> {
  await AsyncStorage.setItem(CONSENT_KEY, JSON.stringify(value))
}
