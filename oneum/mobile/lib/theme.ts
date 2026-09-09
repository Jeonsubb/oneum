/** 온음 디자인 토큰 — 하이파이 목업(UI MOCKUP v3)의 CSS 변수를 그대로 옮긴 것.
 *
 * 목업이 정한 접근성 기준을 수치로 못박아 둔다. 화면을 새로 만들 때 이 값에서 벗어나면
 * 목업과 어긋나므로, 하드코딩 대신 항상 여기를 참조한다.
 *   - 주 터치 타깃 64pt+, 핵심 버튼 88pt+, 간격 16pt+, 본문 18pt
 *   - 아이콘에는 항상 한글 라벨을 붙인다 (아이콘 단독 금지)
 */

/** 색상 버전 — 목업은 파랑(기본)·초록·노랑 세 벌을 제공한다.
 *  노랑(#FFFF00)은 흰 바탕에서 글자색으로 쓸 수 없어(대비 1.07:1)
 *  '채움색'과 '글자·테두리색'을 분리한다. accFill/onAcc/accEdge가 그 장치다. */
export type Palette = 'blue' | 'green' | 'yellow'

export type Colors = {
  ink: string      // 본문 글자
  sub: string      // 보조 글자
  line: string     // 경계선
  soft: string     // 옅은 면
  acc: string      // 강조 글자·테두리
  accTint: string  // 강조 배경(옅은)
  accFill: string  // 강조 채움 배경
  onAcc: string    // 채움 위 글자
  accEdge: string  // 채움 테두리
  warn: string
  warnBg: string
  accShadow: string
  bg: string
}

const PALETTES: Record<Palette, Colors> = {
  // iOS 시스템 디자인 언어 — 설정 앱과 같은 그룹 배경(#F2F2F7) 위에 흰 카드,
  // 강조는 시스템 블루(#007AFF). 채움이 진하므로 채움 위 글자(onAcc)는 흰색.
  blue: {
    ink: '#1C1C1E', sub: '#6D6D72', line: '#E5E5EA', soft: '#E9E9EB',
    acc: '#007AFF', accTint: '#E9F2FF', accFill: '#007AFF', onAcc: '#FFFFFF', accEdge: '#007AFF',
    warn: '#D70015', warnBg: '#FFEBEA', accShadow: 'rgba(0,122,255,.30)', bg: '#F2F2F7',
  },
  green: {
    ink: '#171A18', sub: '#414945', line: '#C1C8C3', soft: '#F0F4F1',
    acc: '#1F5B45', accTint: '#E4EFE9', accFill: '#1F5B45', onAcc: '#FFFFFF', accEdge: '#1F5B45',
    warn: '#7A4100', warnBg: '#FAEEDC', accShadow: 'rgba(31,91,69,.28)', bg: '#FFFFFF',
  },
  yellow: {
    ink: '#1A1A10', sub: '#464632', line: '#C8C8AE', soft: '#F6F6E6',
    acc: '#545400', accTint: '#FCFCC8', accFill: '#FFFF00', onAcc: '#1A1A10', accEdge: '#949400',
    warn: '#99241B', warnBg: '#FAE7E3', accShadow: 'rgba(148,148,0,.42)', bg: '#FFFFFF',
  },
}

export const palette = (p: Palette = 'blue'): Colors => PALETTES[p]

/** 목업의 고정 수치. 이름은 목업 CSS 클래스와 맞춰 두어 대조하기 쉽게 했다. */
export const S = {
  bodyPadX: 24,
  bodyPadTop: 12,
  bodyPadBottom: 34,

  // 버튼
  btnMin: 72,        // .btn
  btnXlMin: 92,      // .btn.primary.xl
  btnTonalMin: 88,   // .btn.tonal
  btnRadius: 18,
  btnFont: 20,
  btnXlFont: 22,

  // 마이크
  micSize: 218,
  micIcon: 70,
  micLabel: 20,

  // 후보
  candMin: 92,       // .cand
  candFont: 24,
  candRadius: 18,
  candSingleMin: 190, // .cand-single
  candSingleFont: 30,

  // 텍스트
  hQ: 26,            // .h-q 질문 제목
  guide: 18,         // .guide 안내문
  bigSay: 54,        // .bigsay 전달 화면 큰 글자
  chipFont: 22,
  chipMin: 60,

  gap: 18,           // .stack gap
  gapSm: 12,
} as const

export const W = {
  black: '900' as const,
  extra: '800' as const,
  bold: '700' as const,
  mid: '600' as const,
}
