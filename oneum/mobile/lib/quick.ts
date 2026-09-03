/** 빠른 발화 저장소 — 등록 목록·이력·실전 연속 카운터. 전부 기기 내 저장(QA-05).
 *  판정기·위험 분류는 quickJudge.ts (순수 함수, 스크립트 검증 대상)에 있다. */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { riskCheck, type QuickEntry, type QuickEvent } from './quickJudge'
import type { Situation } from './profile'

export * from './quickJudge'

const QUICK_KEY = 'oneum.quick.v1'
const EVENT_KEY = 'oneum.quickEvents.v1'
const STREAK_KEY = 'oneum.quickStreak.v1'
const MAX_EVENTS = 500

/* ── 저장소 ────────────────────────────────────────────────── */
export async function loadQuick(): Promise<QuickEntry[]> {
  const raw = await AsyncStorage.getItem(QUICK_KEY)
  return raw ? JSON.parse(raw) : []
}

async function saveQuick(entries: QuickEntry[]): Promise<void> {
  await AsyncStorage.setItem(QUICK_KEY, JSON.stringify(entries))
}

/** 검증 통과 문장의 명시 등록. 재등록(재검증)은 잠금을 해제한다. */
export async function registerQuick(
  text: string,
  situation: Situation,
  unlockPath: QuickEntry['unlockPath'],
): Promise<{ ok: boolean; reason?: string; entries: QuickEntry[] }> {
  const risk = riskCheck(text)
  const entries = await loadQuick()
  if (!risk.ok) return { ok: false, reason: risk.reason, entries }
  const next = [
    ...entries.filter(e => e.text !== text),
    { text, situation, unlockPath, verifiedAt: Date.now(), locked: false },
  ]
  await saveQuick(next)
  return { ok: true, entries: next }
}

/** 오발화 취소 → 해당 문장 자동 잠금 (전체 OFF가 아니라 문장 단위 잠금이다) */
export async function lockQuick(text: string): Promise<QuickEntry[]> {
  const next = (await loadQuick()).map(e => (e.text === text ? { ...e, locked: true } : e))
  await saveQuick(next)
  return next
}

export async function recordQuickEvent(type: QuickEvent['type'], text: string): Promise<void> {
  const raw = await AsyncStorage.getItem(EVENT_KEY)
  const prev: QuickEvent[] = raw ? JSON.parse(raw) : []
  const next = [{ type, text, at: Date.now() }, ...prev].slice(0, MAX_EVENTS)
  await AsyncStorage.setItem(EVENT_KEY, JSON.stringify(next))
}

/** QA-07 측정 원천 열람 — 즉시 발화/강등/취소 이력 (최신순) */
export async function loadQuickEvents(): Promise<QuickEvent[]> {
  const raw = await AsyncStorage.getItem(EVENT_KEY)
  return raw ? JSON.parse(raw) : []
}

/* ── 해금 경로 (b): 실전 이력 — 연속 3회 1순위 즉시 확정 → 등록 제안 ── */
interface StreakMap {
  [text: string]: number
}

/** 게이트에서 문장이 확정될 때마다 호출한다.
 *  1순위를 즉시 확정한 경우에만 연속 횟수가 쌓이고, 다른 문장을 고르면 그 문장 외 연속은 끊긴다.
 *  연속 3회에 도달했고 아직 미등록·저위험이면 등록 제안 대상으로 돌려준다. */
export async function recordLiveConfirm(
  text: string,
  wasTopImmediate: boolean,
): Promise<{ suggest: boolean }> {
  const raw = await AsyncStorage.getItem(STREAK_KEY)
  const map: StreakMap = raw ? JSON.parse(raw) : {}
  const next: StreakMap = wasTopImmediate ? { [text]: (map[text] ?? 0) + 1 } : {}
  await AsyncStorage.setItem(STREAK_KEY, JSON.stringify(next))
  if (!wasTopImmediate || (next[text] ?? 0) < 3) return { suggest: false }
  if (!riskCheck(text).ok) return { suggest: false }
  const registered = (await loadQuick()).some(e => e.text === text && !e.locked)
  return { suggest: !registered }
}
