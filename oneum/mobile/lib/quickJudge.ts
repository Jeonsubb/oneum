/** 빠른 발화 (SF-14/15) — 사전 승인 문장의 즉시 발화를 관장하는 판정기와 저장소.
 *
 *  안전의 원천은 DD-05의 6조건이다. 조건 하나라도 어긋나면 소리 없이 일반 게이트로
 *  강등되고(강등 무표시), 오발화로 취소된 문장은 자동 잠금되어 재검증 없이는 풀리지 않는다.
 *  판정·위험 분류는 순수 함수로 두어 스크립트에서 단독 검증할 수 있게 한다.
 */
import type { RankedCandidate } from './rerank'
import type { Situation } from './profile'

/** 즉시 발화 임계값 — 게이트 확신 임계값(0.75)보다 엄격하다 (조건 3). 보정 전 임시값(BC-04). */
export const GATE_QUICK = 0.9
/** 1·2위 격차 마진 (조건 4) — "물 주세요"↔"불 꺼주세요" 류 경합 차단. 보정 전 임시값. */
export const QUICK_MARGIN = 0.2

export interface QuickEntry {
  text: string
  situation: Situation
  /** 해금 경로 — (a) 연습 검증 / (b) 실전 이력 (DD-05 조건 2) */
  unlockPath: 'practice' | 'live'
  verifiedAt: number
  /** 오발화 취소 시 자동 잠금. 재검증(연습 재등록)으로만 해제된다 (SF-15) */
  locked: boolean
}

/** QA-07 측정 원천 — 즉시 발화/강등/취소 이력 */
export interface QuickEvent {
  type: 'fired' | 'demoted' | 'undone'
  text: string
  at: number
}

/* ── 조건 6: 저위험 화이트리스트 — 고위험 유형은 등록 자체 불가 ── */
// 금액·동의·거절/부정·개인정보 문장은 오발화 비용이 크므로 빠른 발화 대상에서 제외한다.
// 판별은 보수적으로: 애매하면 막는다. 막혀도 일반 확정 게이트로는 언제나 말할 수 있다.
const RISK_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: '금액·결제', re: /[0-9]+\s*원|얼마|결제|카드|현금|계좌|송금|이체|환불/ },
  { label: '동의·승낙', re: /동의|승낙|허락|계약|서명|사인|네,?\s*(맞아요|그렇|할게요)|하겠습니다/ },
  { label: '거절·부정', re: /아니요|아니에요|싫어요|거절|안\s*(할|살|먹|갈)|필요\s*없|하지 마/ },
  { label: '개인정보', re: /주민|전화번호|휴대폰\s*번호|주소는|생년월일|비밀번호|여권/ },
]

/** 등록 가능 여부. 불가하면 사유(유형)를 함께 돌려준다. */
export function riskCheck(text: string): { ok: boolean; reason?: string } {
  for (const { label, re } of RISK_PATTERNS) {
    if (re.test(text)) return { ok: false, reason: label }
  }
  return { ok: true }
}

/* ── 판정기 — DD-05 6조건 전수 검사 (순수 함수) ────────────── */
export interface QuickJudgeInput {
  ranked: RankedCandidate[]
  situation: Situation
  quickOn: boolean
  entries: QuickEntry[]
  /** 현재 시각(ms). 지연 재검증(조건 2-a) 판정에 쓴다. 미지정 시 지연 검사를 건너뛴다. */
  now?: number
}

export type QuickVerdict =
  | { fire: true; text: string }
  | { fire: false; reason: string }

/** 두 시각이 같은 '날'인지 (로컬 자정 경계 기준) */
function sameDay(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
}

export function judgeQuick({ ranked, situation, quickOn, entries, now }: QuickJudgeInput): QuickVerdict {
  const top = ranked[0]
  if (!top) return { fire: false, reason: '후보 없음' }
  // 조건: 설정 ON (기본 OFF, 홈 화면 1탭으로 전체 일시 중지)
  if (!quickOn) return { fire: false, reason: '설정 OFF' }
  const entry = entries.find(e => e.text === top.text)
  // 조건 1: 명시 등록 + 조건 2: 해금 검증 통과 (등록 자체가 검증 통과 후에만 가능)
  if (!entry) return { fire: false, reason: '미등록 문장' }
  if (entry.locked) return { fire: false, reason: '오발화 잠금' }
  // 조건 2-a: 연습 경로는 '다른 날' 지연 재검증을 통과해야 즉시 발화 자격이 생긴다.
  // 등록 당일에는 게이트로만 쓰이고, 다음 날부터 활성화된다 (실전 경로 2-b는 이 제약 없음).
  if (now !== undefined && entry.unlockPath === 'practice' && sameDay(entry.verifiedAt, now)) {
    return { fire: false, reason: '지연 재검증 대기(등록 당일)' }
  }
  // 조건 3: 게이트보다 엄격한 임계값
  if (top.score < GATE_QUICK) return { fire: false, reason: '임계값 미달' }
  // 조건 4: 1·2위 경합 없음
  const second = ranked[1]
  if (second && top.score - second.score < QUICK_MARGIN) return { fire: false, reason: '후보 경합' }
  // 조건 5: 현재 수동 선택된 상황 세트 소속 (DD-06)
  if (entry.situation !== situation) return { fire: false, reason: '상황 불일치' }
  // 조건 6: 저위험 유형 (등록 시 차단되지만 이중으로 재확인)
  if (!riskCheck(top.text).ok) return { fire: false, reason: '고위험 유형' }
  return { fire: true, text: top.text }
}

