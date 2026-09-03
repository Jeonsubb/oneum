/** 빠른 발화 판정기(DD-05 6조건)·저위험 화이트리스트 검증 — `npx tsx scripts/verify-quick.ts`
 *  기대 동작이 문서 역할을 한다. 조건 하나라도 무너지면 즉시 발화가 새는 것이므로 전부 통과해야 한다. */
import { judgeQuick, riskCheck, GATE_QUICK, QUICK_MARGIN, type QuickEntry } from '../lib/quickJudge'
import type { RankedCandidate } from '../lib/rerank'

let failures = 0
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}`)
  if (!cond) failures += 1
}

const entry: QuickEntry = {
  text: '물 한 잔 주세요', situation: '일상', unlockPath: 'practice', verifiedAt: 1, locked: false,
}
const top = (score: number): RankedCandidate => ({ text: '물 한 잔 주세요', score, source: 'profile' })
const rival = (score: number): RankedCandidate => ({ text: '불 좀 꺼 주세요', score, source: 'asr' })

/* 전 조건 충족 → 발화 */
const ok = judgeQuick({ ranked: [top(0.95), rival(0.3)], situation: '일상', quickOn: true, entries: [entry] })
check('6조건 전부 충족 시 즉시 발화', ok.fire === true)

/* 조건별 단일 위반 → 전부 강등 */
check('설정 OFF(기본값) → 강등',
  !judgeQuick({ ranked: [top(0.95)], situation: '일상', quickOn: false, entries: [entry] }).fire)
check('미등록 문장 → 강등',
  !judgeQuick({ ranked: [rival(0.95)], situation: '일상', quickOn: true, entries: [entry] }).fire)
check('오발화 잠금 문장 → 강등',
  !judgeQuick({ ranked: [top(0.95)], situation: '일상', quickOn: true, entries: [{ ...entry, locked: true }] }).fire)
check(`엄격 임계값(${GATE_QUICK}) 미달 → 강등 (게이트 확신 0.75보다 높아도)`,
  !judgeQuick({ ranked: [top(0.8)], situation: '일상', quickOn: true, entries: [entry] }).fire)
check(`1·2위 격차 ${QUICK_MARGIN} 미만(경합) → 강등`,
  !judgeQuick({ ranked: [top(0.95), rival(0.9)], situation: '일상', quickOn: true, entries: [entry] }).fire)
check('상황 불일치(일상 등록 문장을 병원에서) → 강등',
  !judgeQuick({ ranked: [top(0.95)], situation: '병원', quickOn: true, entries: [entry] }).fire)

/* 조건 6 — 저위험 화이트리스트: 고위험 유형은 등록 자체 불가 */
check('금액·결제 문장 등록 차단', !riskCheck('카드로 결제할게요').ok)
check('금액 문장 등록 차단', !riskCheck('삼만 원이에요? 얼마예요').ok)
check('동의 문장 등록 차단', !riskCheck('네 맞아요, 동의합니다').ok)
check('거절·부정 문장 등록 차단', !riskCheck('아니요, 필요 없어요').ok)
check('개인정보 문장 등록 차단', !riskCheck('전화번호는 010입니다').ok)
check('저위험 일상 문장은 등록 가능', riskCheck('물 한 잔 주세요').ok)
check('저위험 인사 문장은 등록 가능', riskCheck('천천히 말씀해 주세요').ok)

/* 판정기에서도 고위험을 이중 차단 (등록 필터를 우회해 들어온 경우) */
const risky: QuickEntry = { ...entry, text: '카드로 결제할게요' }
check('등록돼 있어도 고위험 유형은 판정기가 차단',
  !judgeQuick({
    ranked: [{ text: '카드로 결제할게요', score: 0.95, source: 'profile' }],
    situation: '일상', quickOn: true, entries: [risky],
  }).fire)

/* 조건 2-a — 지연 재검증: 연습 등록 당일은 강등, 다음 날부터 즉시 발화 */
const today = Date.now()
const todayEntry: QuickEntry = { ...entry, verifiedAt: today }
check('연습 등록 당일 → 강등 (지연 재검증 대기)',
  !judgeQuick({ ranked: [top(0.95)], situation: '일상', quickOn: true, entries: [todayEntry], now: today }).fire)
const tomorrow = today + 24 * 3600 * 1000
check('연습 등록 다음 날 → 즉시 발화 활성화',
  judgeQuick({ ranked: [top(0.95)], situation: '일상', quickOn: true, entries: [todayEntry], now: tomorrow }).fire)
check('실전 경로는 지연 재검증 제약 없음 (당일도 즉시 발화)',
  judgeQuick({ ranked: [top(0.95)], situation: '일상', quickOn: true,
    entries: [{ ...todayEntry, unlockPath: 'live' }], now: today }).fire)

console.log(failures === 0 ? '\n전체 통과' : `\n${failures}건 실패`)
process.exit(failures === 0 ? 0 : 1)
