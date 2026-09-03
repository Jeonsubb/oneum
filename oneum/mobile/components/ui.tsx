/** 목업(UI MOCKUP v3)의 공통 UI 조각.
 *  색상 버전은 파랑(딥블루 #14508C)으로 확정했다. theme.ts의 다른 팔레트는 남겨두되 쓰지 않는다. */
import { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native'
import { Icon, IconName } from './Icon'
import { palette, S, W } from '../lib/theme'

export const C = palette('blue')

/** "확정 전에는 소리내지 않아요" — 목업의 .silence.
 *  Relate·Live Speech·Voiceitt는 인식 즉시 말한다. 온음은 확정 전 침묵하며,
 *  그 차이를 사용자가 눈으로 확인할 수 있도록 모든 인식 화면 상단에 고정한다. */
export function SilenceBadge() {
  return (
    <View style={st.silence}>
      <Icon name="voloff" size={18} color={C.sub} />
      <Text style={st.silenceTx}>확정 전에는 소리내지 않아요</Text>
    </View>
  )
}

type BtnVariant = 'primary' | 'outline' | 'tonal'
type BtnProps = {
  label: string
  onPress?: () => void
  variant?: BtnVariant
  icon?: IconName
  xl?: boolean          // .btn.primary.xl — 핵심 확정 버튼 92pt
  style?: ViewStyle
  disabled?: boolean
}

export function Btn({ label, onPress, variant = 'primary', icon, xl, style, disabled }: BtnProps) {
  const isPrimary = variant === 'primary'
  const isTonal = variant === 'tonal'
  const fg = isPrimary ? C.onAcc : C.ink
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        st.btn,
        isPrimary && { backgroundColor: C.accFill, borderColor: C.accEdge },
        variant === 'outline' && { backgroundColor: '#fff', borderColor: '#75787D' },
        isTonal && { backgroundColor: C.soft, borderColor: C.line, minHeight: S.btnTonalMin },
        xl && { minHeight: S.btnXlMin },
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={24} color={fg} />}
      <Text style={[st.btnTx, { color: fg }, (xl || isTonal) && { fontSize: S.btnXlFont }]}>{label}</Text>
    </Pressable>
  )
}

/** 상황 칩 — 목업의 .chip. 자동 추정하지 않고 사용자가 직접 고른다(DD-06). */
export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      accessibilityLabel={`상황 ${label}${on ? ', 선택됨' : ''}`}
      onPress={onPress}
      style={[st.chip, on && { backgroundColor: C.accFill, borderColor: C.accEdge }]}
    >
      {on && <Icon name="check" size={18} color={C.onAcc} />}
      <Text style={[st.chipTx, on && { color: C.onAcc }]}>{label}</Text>
    </Pressable>
  )
}

/** 후보 한 줄 — 목업의 .cand. 오른쪽 '고치기'로 ⑤ 수정 화면으로 간다.
 *  suggested는 LLM 복원 후보(SF-03 slow path) — AI가 만든 문장임을 숨기지 않는다. */
export function Candidate({ text, suggested, onPick, onEdit }: {
  text: string
  suggested?: boolean
  onPick: () => void
  onEdit: () => void
}) {
  return (
    <View style={st.cand}>
      <Pressable style={st.candTap} onPress={onPick} accessibilityRole="button"
        accessibilityLabel={`${suggested ? 'AI 제안, ' : ''}${text}, 이 문장으로 전달`}>
        {suggested && (
          <View style={st.suggestTag}><Text style={st.suggestTagTx}>제안</Text></View>
        )}
        <Text style={st.candTx}>{text}</Text>
      </Pressable>
      <Pressable style={st.editBtn} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`${text} 고치기`}>
        <Icon name="pencil" size={20} color={C.sub} />
        <Text style={st.editTx}>고치기</Text>
      </Pressable>
    </View>
  )
}

/** "이 중에 없어요" — 목업에서 후보와 같은 크기·같은 무게로 배치된 정당한 답. */
export function NoneOfThem({ onPress }: { onPress: () => void }) {
  return (
    <Pressable style={st.cand} onPress={onPress} accessibilityRole="button" accessibilityLabel="이 중에 없어요">
      <View style={[st.candTap, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
        <Icon name="xcirc" size={26} color={C.warn} />
        <Text style={st.candTx}>이 중에 없어요</Text>
      </View>
    </Pressable>
  )
}

export function AppBar({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={st.appbar}>
      {onBack ? (
        <Pressable onPress={onBack} style={st.backBtn} accessibilityRole="button" accessibilityLabel="뒤로">
          <Icon name="back" size={20} color={C.sub} />
          <Text style={st.backTx}>뒤로</Text>
        </Pressable>
      ) : <View style={{ width: 76 }} />}
      {title ? <Text style={st.barTitle}>{title}</Text> : <View />}
      {right ?? <View style={{ width: 76 }} />}
    </View>
  )
}

export function Spacer() { return <View style={{ flex: 1 }} /> }

/** 하단 탭 바 — 최상위 세 화면(말하기·즐겨찾기·연습)을 오간다.
 *  대화 흐름 중(듣는 중·확인·전달 등)에는 숨겨서 '한 화면 한 작업' 원칙을 지킨다.
 *  아이콘은 항상 한글 라벨과 함께 두고(목업 원칙 4), 터치 타깃을 크게 잡는다. */
export type TabKey = 'home' | 'practice'

const TAB_ITEMS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'home', label: '말하기', icon: 'mic' },
  { key: 'practice', label: '연습', icon: 'redo' },
]

export function TabBar({ active, onSelect }: { active: TabKey; onSelect: (k: TabKey) => void }) {
  return (
    <View style={st.tabBar} accessibilityRole="tablist">
      {TAB_ITEMS.map(t => {
        const on = t.key === active
        return (
          <Pressable key={t.key} onPress={() => onSelect(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${t.label}${on ? ', 선택됨' : ''}`}
            style={st.tab}>
            <Icon name={t.icon} size={26} color={on ? C.acc : C.sub} />
            <Text style={[st.tabTx, on && { color: C.acc, fontWeight: W.extra }]}>{t.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const st = StyleSheet.create({
  silence: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6,
    backgroundColor: C.soft, borderWidth: 1.5, borderColor: C.line, borderRadius: 999,
    paddingVertical: 8, paddingHorizontal: 16,
  },
  silenceTx: { fontSize: 15, fontWeight: W.bold, color: C.sub },

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    width: '100%', minHeight: S.btnMin, borderRadius: S.btnRadius, borderWidth: 2,
    paddingVertical: 12, paddingHorizontal: 18,
  },
  btnTx: { fontSize: S.btnFont, fontWeight: W.extra, textAlign: 'center' },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: S.chipMin,
    paddingHorizontal: 24, borderRadius: 28, borderWidth: 2, borderColor: C.line, backgroundColor: '#fff',
  },
  chipTx: { fontSize: S.chipFont, fontWeight: W.bold, color: C.sub },

  cand: {
    flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: S.candMin,
    borderWidth: 2, borderColor: '#85888E', borderRadius: S.candRadius,
    paddingVertical: 16, paddingRight: 14, paddingLeft: 22, backgroundColor: '#fff',
  },
  candTap: { flex: 1, justifyContent: 'center', minHeight: 60 },
  candTx: { fontSize: S.candFont, fontWeight: W.bold, lineHeight: S.candFont * 1.4, color: C.ink },
  suggestTag: {
    alignSelf: 'flex-start', backgroundColor: C.accTint, borderWidth: 1.5, borderColor: C.acc,
    borderRadius: 999, paddingVertical: 2, paddingHorizontal: 10, marginBottom: 6,
  },
  suggestTagTx: { fontSize: 13, fontWeight: W.extra, color: C.acc },
  editBtn: {
    width: 64, height: 64, borderRadius: 14, borderWidth: 1.5, borderColor: C.line,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  editTx: { fontSize: 13, fontWeight: W.bold, color: C.sub },

  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: C.line,
    borderRadius: 12, paddingVertical: 10, paddingLeft: 8, paddingRight: 14,
  },
  backTx: { fontSize: 16, fontWeight: W.bold, color: C.sub },
  barTitle: { fontSize: 20, fontWeight: W.extra, color: C.ink },

  tabBar: {
    flexDirection: 'row', borderTopWidth: 1.5, borderTopColor: C.line,
    backgroundColor: '#fff', paddingTop: 8, paddingHorizontal: 8,
  },
  tab: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4,
    minHeight: 60, paddingVertical: 4, borderRadius: 14,
  },
  tabTx: { fontSize: 13, fontWeight: W.bold, color: C.sub },
})

export const layout = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  body: { flex: 1, paddingTop: S.bodyPadTop, paddingHorizontal: S.bodyPadX, paddingBottom: S.bodyPadBottom },
  stack: { gap: S.gap },
  hQ: { fontSize: S.hQ, fontWeight: W.extra, lineHeight: S.hQ * 1.4, marginTop: 26, color: C.ink },
  guide: { fontSize: S.guide, color: C.sub, textAlign: 'center', lineHeight: S.guide * 1.55, maxWidth: 300 },
  fieldLabel: { fontSize: 18, fontWeight: W.extra, color: C.ink, marginTop: 18 },
})
