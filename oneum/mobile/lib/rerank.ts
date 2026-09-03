// 후보 재정렬 (SF-03 fast path) — 온디바이스, 네트워크·LLM 불필요.
// ASR이 뭉갠 결과를 "이 사람이 실제로 자주 하는 말" 쪽으로 끌어당기는 것이 목적이다.
import { similarity } from './hangul'
import type { Correction, Phrase, Situation } from './profile'

export interface RankedCandidate {
  text: string
  score: number
  source: 'asr' | 'profile' | 'llm'
  /** 프로필 문장이 어떤 ASR 후보와 매칭됐는지 — 디버깅·시연 설명용 */
  matchedFrom?: string
}

// 가중치는 전부 보정 전 임시값 (당사자 검증 발화로 보정 예정, BC-04)
const W_SIMILARITY = 1.0
const W_SITUATION = 0.15
const W_USAGE = 0.1
const W_CORRECTION = 0.3
const W_ASR_CONFIDENCE = 0.9
const MIN_SIMILARITY = 0.35

export interface RerankInput {
  asrCandidates: Array<{ text: string; confidence: number }>
  phrases: Phrase[]
  corrections: Correction[]
  situation: Situation
}

export function rerank({
  asrCandidates,
  phrases,
  corrections,
  situation,
}: RerankInput): RankedCandidate[] {
  const ranked: RankedCandidate[] = []

  for (const phrase of phrases) {
    let bestSim = 0
    let bestFrom = ''
    for (const cand of asrCandidates) {
      const sim = similarity(cand.text, phrase.text)
      if (sim > bestSim) {
        bestSim = sim
        bestFrom = cand.text
      }
    }
    if (bestSim < MIN_SIMILARITY) continue

    // 같은 오인식을 이전에 이 문장으로 고친 적이 있으면 강하게 가산 (SF-07 축적 효과).
    // 유사도 1위 후보(bestFrom)만 보면 과거 교정과 닮은 후보가 2·3위일 때 이력을 놓치므로
    // N-best 전체를 대조한다.
    const correctionHit = corrections.some(
      (c) =>
        c.confirmedText === phrase.text &&
        asrCandidates.some((cand) => similarity(c.asrText, cand.text) > 0.7),
    )

    ranked.push({
      text: phrase.text,
      source: 'profile',
      matchedFrom: bestFrom,
      score:
        bestSim * W_SIMILARITY +
        (phrase.situation === situation ? W_SITUATION : 0) +
        Math.min(1, Math.log10(phrase.useCount + 1)) * W_USAGE +
        (correctionHit ? W_CORRECTION : 0),
    })
  }

  // 프로필에 없는 말도 해야 하므로 ASR 원문 후보를 항상 함께 경쟁시킨다
  for (const cand of asrCandidates) {
    if (ranked.some((r) => r.text === cand.text)) continue
    ranked.push({
      text: cand.text,
      source: 'asr',
      score: cand.confidence * W_ASR_CONFIDENCE,
    })
  }

  return ranked
    .sort((a, b) => b.score - a.score)
    .filter((r, i, arr) => arr.findIndex((x) => x.text === r.text) === i)
}
