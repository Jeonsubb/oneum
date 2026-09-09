/** 목업(UI MOCKUP v3)의 공통 UI 조각.
 *  색상 버전은 파랑(딥블루 #14508C)으로 확정했다. theme.ts의 다른 팔레트는 남겨두되 쓰지 않는다. */
import { ReactNode, useEffect, useRef } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native'
import { BlurView } from 'expo-blur'
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Icon, IconName } from './Icon'
import { palette, S, W } from '../lib/theme'

/** iOS 26 리퀴드 글래스 사용 가능 여부 — 미만 버전·웹에서는 블러/단색으로 폴백한다. */
export const GLASS = isLiquidGlassAvailable()

export const C = palette('blue')

export const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/** 화면 전환 연출 — 새 화면이 아래에서 살짝 떠오르며 나타난다(토스식).
 *  화면이 뚝 바뀌는 대신 방향감을 주어 흐름이 이어지는 느낌을 만든다.
 *  id(현재 화면 이름)가 바뀔 때마다 다시 재생된다. */
export function ScreenFade({ id, children }: { id: string; children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    v.setValue(0)
    Animated.timing(v, {
      toValue: 1, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start()
  }, [id, v])
  return (
    <Animated.View style={{
      flex: 1, opacity: v,
      transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
    }}>
      {children}
    </Animated.View>
  )
}

/** 눌림 반응 공통 훅 — 누르면 살짝 줄었다가 스프링으로 복귀한다.
 *  투명도만 바뀌던 기존 반응보다 "눌렀다"는 확신을 손끝에 준다(운동 조절이 어려운 사용자 배려). */
export function usePressScale(pressedScale = 0.97) {
  const v = useRef(new Animated.Value(1)).current
  const onPressIn = () =>
    Animated.timing(v, { toValue: pressedScale, duration: 90, useNativeDriver: true }).start()
  const onPressOut = () =>
    Animated.spring(v, { toValue: 1, friction: 5, tension: 220, useNativeDriver: true }).start()
  return { scale: v, onPressIn, onPressOut }
}

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
  const press = usePressScale(0.97)
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled}
      style={[
        st.btn,
        // iOS 버튼은 테두리 없이 채움색으로만 위계를 만든다 (filled / gray / bordered)
        isPrimary && { backgroundColor: C.accFill },
        variant === 'outline' && { backgroundColor: '#fff', borderWidth: 1, borderColor: '#C7C7CC' },
        isTonal && { backgroundColor: C.soft, minHeight: S.btnTonalMin },
        xl && { minHeight: S.btnXlMin },
        disabled && { opacity: 0.45 },
        style,
        { transform: [{ scale: press.scale }] },
      ]}
    >
      {icon && <Icon name={icon} size={24} color={fg} />}
      <Text style={[st.btnTx, { color: fg }, (xl || isTonal) && { fontSize: S.btnXlFont }]}>{label}</Text>
    </AnimatedPressable>
  )
}

/** 상황 칩 — 목업의 .chip. 자동 추정하지 않고 사용자가 직접 고른다(DD-06).
 *  iOS 26에서는 리퀴드 글래스 캡슐로 그려진다(선택 시 파랑 틴트). */
export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  const inner = (
    <>
      {on && <Icon name="check" size={18} color={C.onAcc} />}
      <Text style={[st.chipTx, on && { color: C.onAcc }]}>{label}</Text>
    </>
  )
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      accessibilityLabel={`상황 ${label}${on ? ', 선택됨' : ''}`}
      onPress={onPress}
    >
      {GLASS ? (
        <GlassView glassEffectStyle="regular" isInteractive tintColor={on ? C.acc : undefined}
          style={st.chipGlass}>
          {inner}
        </GlassView>
      ) : (
        <View style={[st.chip, on && { backgroundColor: C.accFill, borderColor: C.accEdge }]}>
          {inner}
        </View>
      )}
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
        // iOS 26 내비게이션의 뒤로 버튼 — 리퀴드 글래스 캡슐 (미지원 시 파란 텍스트)
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="뒤로"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          {GLASS ? (
            <GlassView glassEffectStyle="regular" isInteractive style={st.backGlass}>
              <Icon name="back" size={19} color={C.acc} />
              <Text style={st.backTx}>뒤로</Text>
            </GlassView>
          ) : (
            <View style={st.backBtn}>
              <Icon name="back" size={20} color={C.acc} />
              <Text style={st.backTx}>뒤로</Text>
            </View>
          )}
        </Pressable>
      ) : <View style={{ width: 76 }} />}
      {title ? <Text style={st.barTitle}>{title}</Text> : <View />}
      {right ?? <View style={{ width: 76 }} />}
    </View>
  )
}

export function Spacer() { return <View style={{ flex: 1 }} /> }

/** 하단 탭 바 — 최상위 세 화면(말하기·연습·대화)을 오간다.
 *  대화 흐름 중(듣는 중·확인·전달 등)에는 숨겨서 '한 화면 한 작업' 원칙을 지킨다.
 *  아이콘은 항상 한글 라벨과 함께 두고(목업 원칙 4), 터치 타깃을 크게 잡는다. */
export type TabKey = 'home' | 'practice' | 'chat'

const TAB_ITEMS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'home', label: '말하기', icon: 'mic' },
  { key: 'practice', label: '연습', icon: 'redo' },
  { key: 'chat', label: '대화', icon: 'chat' },
]

/** 루트 화면 콘텐츠가 탭바에 가리지 않도록 확보해야 하는 하단 여백(세이프에어리어 제외). */
export const TABBAR_CONTENT_HEIGHT = 84

export function TabBar({ active, onSelect }: { active: TabKey; onSelect: (k: TabKey) => void }) {
  const insets = useSafeAreaInsets()
  const items = TAB_ITEMS.map(t => {
    const on = t.key === active
    return (
      <Pressable key={t.key} onPress={() => onSelect(t.key)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${t.label}${on ? ', 선택됨' : ''}`}
        style={st.tab}>
        <Icon name={t.icon} size={27} color={on ? C.acc : '#8E8E93'} />
        <Text style={[st.tabTx, on && { color: C.acc, fontWeight: W.extra }]}>{t.label}</Text>
      </Pressable>
    )
  })
  // iOS 26 탭바 — 화면 위에 떠 있는 리퀴드 글래스 캡슐. 미지원 환경은 블러 캡슐로 폴백.
  const bottom = Math.max(insets.bottom, 12)
  return GLASS ? (
    <GlassView glassEffectStyle="regular" style={[st.tabBar, { bottom }]} accessibilityRole="tablist">
      {items}
    </GlassView>
  ) : (
    <BlurView intensity={95} tint="extraLight"
      style={[st.tabBar, st.tabBarFallback, { bottom }]} accessibilityRole="tablist">
      {items}
    </BlurView>
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
    width: '100%', minHeight: S.btnMin, borderRadius: 16,
    paddingVertical: 12, paddingHorizontal: 18,
  },
  btnTx: { fontSize: S.btnFont, fontWeight: W.extra, textAlign: 'center' },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: S.chipMin,
    paddingHorizontal: 24, borderRadius: 999, borderWidth: 1, borderColor: '#C7C7CC', backgroundColor: '#fff',
  },
  chipTx: { fontSize: S.chipFont, fontWeight: W.bold, color: C.ink },

  // 후보 카드 — iOS 그룹 리스트처럼 테두리 없는 흰 카드. 그룹 배경(#F2F2F7)과의
  // 대비만으로 구분되고, 그림자는 들릴 듯 말 듯한 수준만 남긴다(플랫).
  cand: {
    flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: S.candMin,
    borderRadius: 16,
    paddingVertical: 16, paddingRight: 14, paddingLeft: 22, backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  candTap: { flex: 1, justifyContent: 'center', minHeight: 60 },
  candTx: { fontSize: S.candFont, fontWeight: W.bold, lineHeight: S.candFont * 1.4, color: C.ink },
  suggestTag: {
    alignSelf: 'flex-start', backgroundColor: C.accTint, borderWidth: 1.5, borderColor: C.acc,
    borderRadius: 999, paddingVertical: 2, paddingHorizontal: 10, marginBottom: 6,
  },
  suggestTagTx: { fontSize: 13, fontWeight: W.extra, color: C.acc },
  editBtn: {
    width: 64, height: 64, borderRadius: 12,
    backgroundColor: C.soft, alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  editTx: { fontSize: 13, fontWeight: W.bold, color: C.sub },

  appbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 10, paddingRight: 14,
  },
  backGlass: {
    flexDirection: 'row', alignItems: 'center', gap: 4, overflow: 'hidden',
    borderRadius: 999, paddingVertical: 9, paddingLeft: 10, paddingRight: 16,
  },
  backTx: { fontSize: 17, fontWeight: W.bold, color: C.acc },

  chipGlass: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: S.chipMin,
    paddingHorizontal: 24, borderRadius: 999, overflow: 'hidden',
  },
  barTitle: { fontSize: 20, fontWeight: W.extra, color: C.ink },

  // iOS 26 탭바 — 좌우 여백을 두고 떠 있는 캡슐. 재질(글래스/블러)이 배경을 비춘다.
  tabBar: {
    position: 'absolute', left: 20, right: 20,
    flexDirection: 'row', overflow: 'hidden', borderRadius: 999,
    paddingVertical: 7, paddingHorizontal: 10,
  },
  tabBarFallback: { backgroundColor: 'rgba(249,249,249,0.80)' },
  tab: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3,
    minHeight: 54, paddingVertical: 2, borderRadius: 999,
  },
  tabTx: { fontSize: 12, fontWeight: W.bold, color: '#8E8E93' },
})

export const layout = StyleSheet.create({
  // 전체 배경은 순백이 아니라 아주 옅은 웜그레이 — 흰 카드·버튼이 배경 위에 살짝 떠 보인다
  screen: { flex: 1, backgroundColor: C.bg },
  body: { flex: 1, paddingTop: S.bodyPadTop, paddingHorizontal: S.bodyPadX, paddingBottom: S.bodyPadBottom },
  stack: { gap: S.gap },
  hQ: { fontSize: S.hQ, fontWeight: W.extra, lineHeight: S.hQ * 1.4, marginTop: 26, color: C.ink },
  guide: { fontSize: S.guide, color: C.sub, textAlign: 'center', lineHeight: S.guide * 1.55, maxWidth: 300 },
  fieldLabel: { fontSize: 18, fontWeight: W.extra, color: C.ink, marginTop: 18 },
})
