// 한글 자모 분해 기반 유사도.
// 구음장애 발화의 오인식은 음절이 통째로 틀리기보다 초/중/종성 일부가 어긋나는 경우가 많다
// ("물"→"무루", "주세요"→"주세여"). 음절 단위 편집거리는 이를 전부 '완전 불일치'로 보지만,
// 자모 단위로 펼치면 부분 일치를 점수에 반영할 수 있다.
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ']
const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']

const SYLLABLE_START = 0xac00
const SYLLABLE_END = 0xd7a3

/** 문자열을 자모 배열로 펼친다. 공백·문장부호는 제거해 발화 내용만 비교한다. */
export function toJamo(text: string): string[] {
  const out: string[] = []
  for (const ch of text.replace(/[\s.,!?~"'·]/g, '')) {
    const code = ch.charCodeAt(0)
    if (code >= SYLLABLE_START && code <= SYLLABLE_END) {
      const offset = code - SYLLABLE_START
      out.push(CHO[Math.floor(offset / 588)])
      out.push(JUNG[Math.floor((offset % 588) / 28)])
      const jong = JONG[offset % 28]
      if (jong) out.push(jong)
    } else {
      out.push(ch)
    }
  }
  return out
}

function editDistance(a: string[], b: string[]): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[b.length]
}

/** 0(무관) ~ 1(동일). 자모 편집거리를 긴 쪽 길이로 정규화한다. */
export function similarity(a: string, b: string): number {
  const ja = toJamo(a)
  const jb = toJamo(b)
  const longest = Math.max(ja.length, jb.length)
  if (longest === 0) return 0
  return 1 - editDistance(ja, jb) / longest
}
