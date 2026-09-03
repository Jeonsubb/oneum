import { rerank } from '../lib/rerank'
import { similarity } from '../lib/hangul'
import type { Phrase, Correction } from '../lib/profile'

const phrases: Phrase[] = [
  { id: '1', text: '물 한 잔 주세요', situation: '일상', useCount: 5 },
  { id: '2', text: '천천히 말씀해 주세요', situation: '일상', useCount: 0 },
  { id: '3', text: '접수하러 왔어요', situation: '병원', useCount: 3 },
  { id: '4', text: '예약했어요', situation: '병원', useCount: 0 },
  { id: '5', text: '카드로 결제할게요', situation: '매장', useCount: 0 },
]

console.log('=== 자모 유사도 확인 (음절 단위였다면 전부 0에 가까움) ===')
for (const [a, b] of [['무루 주세여','물 한 잔 주세요'],['접수하러 와써요','접수하러 왔어요'],['예야캐써요','예약했어요'],['물 한 잔 주세요','카드로 결제할게요']]) {
  console.log(`  "${a}" vs "${b}" → ${(similarity(a,b)*100).toFixed(1)}%`)
}

function show(title: string, out: ReturnType<typeof rerank>) {
  console.log(`\n=== ${title} ===`)
  out.slice(0, 3).forEach((r, i) =>
    console.log(`  ${i+1}. "${r.text}" (${r.score.toFixed(3)}, ${r.source}${r.matchedFrom ? ` ← "${r.matchedFrom}"` : ''})`))
}

// 시나리오 1: 구음장애 발화를 ASR이 뭉갬. 프로필이 원래 의도를 복원해야 함
show('시나리오1 "물 한 잔 주세요"를 뭉갠 인식 (상황: 일상)', rerank({
  asrCandidates: [
    { text: '무루 주세여', confidence: 0.31 },
    { text: '무료 주세요', confidence: 0.22 },
    { text: '누구세요', confidence: 0.15 },
  ],
  phrases, corrections: [], situation: '일상',
}))

// 시나리오 2: 같은 발화, 상황만 병원 → 일상 문장의 상황 가산점이 빠짐
show('시나리오2 동일 인식, 상황만 "병원"', rerank({
  asrCandidates: [
    { text: '무루 주세여', confidence: 0.31 },
    { text: '무료 주세요', confidence: 0.22 },
  ],
  phrases, corrections: [], situation: '병원',
}))

// 시나리오 3: 교정 이력 축적 효과 (SF-07) — 전에 같은 오인식을 이 문장으로 고쳤음
const corrections: Correction[] = [
  { asrText: '예야캐써요', confirmedText: '예약했어요', at: Date.now() },
]
show('시나리오3 교정 이력 없음 (상황: 병원)', rerank({
  asrCandidates: [{ text: '예야캐써요', confidence: 0.28 }, { text: '이야기했어요', confidence: 0.41 }],
  phrases, corrections: [], situation: '병원',
}))
show('시나리오3 교정 이력 있음 — 같은 입력', rerank({
  asrCandidates: [{ text: '예야캐써요', confidence: 0.28 }, { text: '이야기했어요', confidence: 0.41 }],
  phrases, corrections, situation: '병원',
}))

// 시나리오 4: 프로필에 없는 말 — ASR 원문이 살아남아야 함
show('시나리오4 프로필에 없는 발화 (원문 보존 확인)', rerank({
  asrCandidates: [{ text: '내일 서울역에서 만나요', confidence: 0.88 }],
  phrases, corrections: [], situation: '일상',
}))
