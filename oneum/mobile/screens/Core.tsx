/** 핵심 흐름 화면 ① ② ③ ④ ⑥ — 목업 ROW A·B·C.
 *
 *  설계 원칙(목업 헤더에 명시된 4가지)을 화면 구조로 옮긴다.
 *   1. 승인 없는 발화 0건 — 확정 버튼 전까지 어떤 소리도 나지 않는다
 *   2. 불확실성 공개 — %가 아니라 후보 나열. 미리 선택해두지 않는다
 *   3. 실패해도 대화는 계속 — 막다른 화면을 만들지 않는다
 *   4. 한 화면 한 작업
 */
import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useAudioRecorderState, type AudioRecorder } from 'expo-audio'
import { Icon } from '../components/Icon'
import { Wordmark } from '../components/Wordmark'
import {
  AnimatedPressable, AppBar, Btn, C, Candidate, Chip, NoneOfThem, SilenceBadge, Spacer,
  layout, usePressScale,
} from '../components/ui'
import { S, W } from '../lib/theme'

export { SITUATIONS } from '../lib/profile'
export type { Situation } from '../lib/profile'
import { SITUATIONS } from '../lib/profile'
import type { Situation } from '../lib/profile'

/* ── ① 홈 / 대기 ─────────────────────────────────────────── */
export function HomeScreen({
  situation, onSituation, onMicDown, quickOn, onPauseQuick, notice,
}: {
  situation: Situation
  onSituation: (s: Situation) => void
  onMicDown: () => void
  quickOn?: boolean          // ⑬ 홈 변형 — 빠른 발화 켜짐(기본 OFF)
  onPauseQuick?: () => void
  /** QA-05 — 음성이 어디로 가는지 숨기지 않는다 */
  notice?: string
}) {
  return (
    <View style={layout.body}>
      <View style={st.appbarRow}>
        <Wordmark height={30} />
      </View>

      {quickOn && (
        // 빠른 발화가 켜져 있음을 숨기지 않는다. 일시 중지는 탭 한 번 거리(DD-05).
        <Pressable onPress={onPauseQuick} style={st.quickBar} accessibilityRole="button"
          accessibilityLabel="빠른 발화 켜짐, 눌러서 일시 중지">
          <Icon name="vol" size={18} color={C.acc} />
          <Text style={st.quickTx}>빠른 발화 켜짐 · 등록한 문장만</Text>
          <Text style={st.quickPause}>일시 중지</Text>
        </Pressable>
      )}

      <Text style={layout.fieldLabel}>지금 상황을 골라주세요</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={st.chipsScroll} contentContainerStyle={st.chips}>
        {SITUATIONS.map(s => (
          <Chip key={s} label={s} on={s === situation} onPress={() => onSituation(s)} />
        ))}
      </ScrollView>

      <View style={st.micWrap}>
        <MicButton onPress={onMicDown} />
        <Text style={layout.guide}>누르면 듣기 시작해요.{'\n'}다 말한 뒤 한 번 더 눌러 주세요</Text>
      </View>

      {notice ? (
        <View style={st.notice} accessibilityRole="text" accessibilityLabel={`개인정보 안내. ${notice}`}>
          <Icon name="voloff" size={16} color={C.sub} />
          <Text style={st.noticeTx}>{notice}</Text>
        </View>
      ) : null}
    </View>
  )
}

/** 마이크 버튼 — 평상시 아주 느리게 숨쉬듯 커졌다 작아지고(눌러도 된다는 초대),
 *  누르면 눌린 만큼 줄었다가 스프링으로 복귀한다(Shazam식 촉감). */
function MicButton({ onPress }: { onPress: () => void }) {
  const press = usePressScale(0.93)
  const breath = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 2100, useNativeDriver: true }),
      Animated.timing(breath, { toValue: 0, duration: 2100, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [breath])
  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.022] })
  return (
    <Animated.View style={{ transform: [{ scale: breathScale }] }}>
      <AnimatedPressable onPress={onPress} accessibilityRole="button"
        accessibilityLabel="눌러서 말하기. 누르면 듣기 시작하고, 다 말한 뒤 한 번 더 누르면 됩니다"
        onPressIn={press.onPressIn} onPressOut={press.onPressOut}
        style={[st.micBtn, { transform: [{ scale: press.scale }] }]}>
        <Icon name="mic" size={S.micIcon} color={C.onAcc} />
        <Text style={st.micLabel}>눌러서 말하기</Text>
      </AnimatedPressable>
    </Animated.View>
  )
}

/* ── ② 듣는 중 ───────────────────────────────────────────── */
export function ListeningScreen({
  recorder, onStop, onCancel,
}: { recorder: AudioRecorder; onStop: () => void; onCancel: () => void }) {
  return (
    <View style={layout.body}>
      <SilenceBadge />
      <View style={[st.micWrap, { gap: 30 }]}>
        <View style={{ alignItems: 'center' }}>
          <Text style={st.listenTitle}>듣고 있어요</Text>
          {/* 카운트다운·제한시간을 두지 않는다. 사용자의 말 속도를 시스템이 기다린다. */}
          <Text style={st.listenSub}>다 말했으면 버튼을 한 번 더 눌러 주세요</Text>
        </View>
        {/* 마이크 뒤 파동이 목소리 크기에 실시간으로 반응한다 — 내 소리가 닿고 있다는 증거 */}
        <View style={st.rippleWrap}>
          <VoiceWave recorder={recorder} />
          <Pressable onPress={onStop} accessibilityRole="button" accessibilityLabel="말하는 중, 눌러서 끝내기"
            style={st.micBtn}>
            <Icon name="mic" size={S.micIcon} color={C.onAcc} />
            <Text style={st.micLabel}>말하는 중</Text>
          </Pressable>
        </View>
      </View>
      {/* 유일한 분기는 취소이며 마이크와 멀리 떨어뜨린다 */}
      <Btn label="취소" variant="outline" icon="x" onPress={onCancel} />
    </View>
  )
}

/** 목소리 크기(데시벨)에 반응하는 파동 — 두 겹의 후광이 레벨에 따라 커졌다 작아진다.
 *  안쪽은 빠르게(즉각 반응), 바깥쪽은 느리게(잔물결처럼 따라오는 여운) 움직여
 *  말할 때마다 물결이 일렁이는 느낌을 만든다. 조용하면 잔잔하게 가라앉는다. */
function VoiceWave({ recorder }: { recorder: AudioRecorder }) {
  // 80ms 간격으로 녹음 상태(metering dB)를 읽는다. iOS 기준 무음 ≈ -50 이하, 큰 소리 ≈ -5.
  const state = useAudioRecorderState(recorder, 80)
  const fast = useRef(new Animated.Value(0)).current
  const slow = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const db = state.metering ?? -60
    const level = Math.min(1, Math.max(0, (db + 50) / 42))   // -50dB→0, -8dB→1
    Animated.timing(fast, { toValue: level, duration: 90, useNativeDriver: true }).start()
    Animated.timing(slow, { toValue: level, duration: 420, useNativeDriver: true }).start()
  }, [state.metering, fast, slow])

  const halo = (v: Animated.Value, maxScale: number, maxOpacity: number) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.12, maxOpacity] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1.02, maxScale] }) }],
  })

  return (
    <>
      <Animated.View pointerEvents="none" style={[st.ring, halo(slow, 1.85, 0.35)]} />
      <Animated.View pointerEvents="none" style={[st.ring, halo(fast, 1.45, 0.55)]} />
    </>
  )
}

/* ── ③ 확인 화면 A — 인식 확신 ───────────────────────────── */
export function ConfirmSureScreen({
  text, onConfirm, onSeeOthers,
}: { text: string; onConfirm: () => void; onSeeOthers: () => void }) {
  return (
    <View style={layout.body}>
      <SilenceBadge />
      <Text style={layout.hQ}>이 말이 맞나요?</Text>
      {/* 확신해도 재생하지 않고 먼저 묻는다. '맞아요'만이 문장을 내보내는 유일한 관문. */}
      <View style={st.candSingle}><Text style={st.candSingleTx}>{text}</Text></View>
      <Spacer />
      <View style={layout.stack}>
        <Btn label="맞아요, 전달하기" icon="check" xl onPress={onConfirm} />
        <Btn label="아니에요, 다른 후보 보기" variant="outline" onPress={onSeeOthers} />
      </View>
    </View>
  )
}

/* ── ④ 확인 화면 B — 인식 불확실 (핵심) ──────────────────── */
export function ConfirmChoiceScreen({
  candidates, onPick, onEdit, onNone,
}: {
  candidates: Array<{ text: string; suggested?: boolean }>
  onPick: (t: string) => void
  onEdit: (t: string) => void
  onNone: () => void
}) {
  return (
    <View style={layout.body}>
      <SilenceBadge />
      {/* 불확실성을 숫자 %가 아니라 사람 말로 공개한다 */}
      <Text style={layout.hQ}>이렇게 들렸어요.{'\n'}맞는 걸 골라주세요</Text>
      <ScrollView style={{ marginTop: 20 }} contentContainerStyle={{ gap: 16 }}>
        {candidates.map((c, i) => (
          <Candidate key={`${c.text}-${i}`} text={c.text} suggested={c.suggested}
            onPick={() => onPick(c.text)} onEdit={() => onEdit(c.text)} />
        ))}
        {/* 후보와 같은 크기·같은 무게의 정당한 답 */}
        <NoneOfThem onPress={onNone} />
      </ScrollView>
      <Text style={st.hintCenter}>문장을 누르면 바로 전달 화면으로 갑니다</Text>
    </View>
  )
}

/* ── ⑥ 전달 — 상대방이 보는 화면 ─────────────────────────── */
export function DeliverScreen({
  text, device, onSpeak, onBack, onNext, speaking, quickSuggest, onQuickAccept, onQuickDismiss,
}: {
  text: string
  device: string
  onSpeak: () => void
  onBack: () => void
  /** 발화 하나를 끝낸 뒤 곧바로 다음 말을 하기 위해 마이크로 되돌아간다 */
  onNext: () => void
  speaking?: boolean
  /** 실전 해금 경로 (DD-05 조건 2-b): 연속 3회 1순위 즉시 확정 → 시스템이 등록을 '제안'만 한다 */
  quickSuggest?: boolean
  onQuickAccept?: () => void
  onQuickDismiss?: () => void
}) {
  // 대면 모드 — 문장만 화면 가득. 화면 어디를 눌러도 돌아온다.
  const [zoom, setZoom] = useState(false)
  if (zoom) {
    return (
      <Pressable style={st.zoomWrap} onPress={() => setZoom(false)}
        accessibilityRole="button" accessibilityLabel={`${text}. 화면을 누르면 돌아갑니다`}>
        <Text style={st.zoomTx} adjustsFontSizeToFit numberOfLines={5} minimumFontScale={0.4}>{text}</Text>
        <Text style={st.zoomClose}>화면을 누르면 돌아가요</Text>
      </Pressable>
    )
  }
  return (
    <View style={layout.body}>
      <View style={st.appbarRow}>
        <Pressable onPress={onBack} style={st.backPlain} accessibilityRole="button" accessibilityLabel="뒤로">
          <Icon name="back" size={20} color={C.sub} />
          <Text style={st.txtBtnTx}>뒤로</Text>
        </Pressable>
      </View>
      {quickSuggest && (
        <View style={st.quickSuggest}>
          <Text style={st.quickSuggestTx}>
            이 문장은 최근 3번 연속 바로 확정됐어요.{'\n'}빠른 발화로 등록할까요?
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Btn label="등록" onPress={onQuickAccept} style={{ flex: 1, minHeight: 52 }} />
            <Btn label="나중에" variant="outline" onPress={onQuickDismiss} style={{ flex: 1, minHeight: 52 }} />
          </View>
        </View>
      )}
      {/* 점원·접수 직원이 1~2초에 읽는 화면. 확정 문장 외엔 아무것도 두지 않는다.
          문장이 길면 글자를 줄여서라도 잘리지 않게 한다(받침 있는 한글이 아래로 잘리던 문제).
          문장을 누르면 대면 모드 — 버튼까지 치우고 문장만 가득 띄운다(Apple 번역 앱의 대면 모드 참고). */}
      <Pressable style={st.bigSayWrap} onPress={() => setZoom(true)}
        accessibilityRole="button" accessibilityLabel="문장을 상대에게 크게 보여주기">
        <Text style={st.bigSay} adjustsFontSizeToFit numberOfLines={4} minimumFontScale={0.5}>{text}</Text>
        <View style={st.zoomHintRow}>
          <Icon name="chev" size={14} color={C.sub} />
          <Text style={st.zoomHintTx}>문장을 누르면 상대에게 크게 보여줄 수 있어요</Text>
        </View>
      </Pressable>
      <View style={st.sayRow}>
        <Btn label={speaking ? '말하는 중…' : '소리로 말하기'} icon="vol" onPress={onSpeak}
          style={{ flex: 1, minHeight: 96 }} />
        {/* 어느 기기에서 소리가 날지 항상 표기한다 (QA-01) */}
        <View style={st.devBox}>
          <Icon name="phone" size={20} color={C.sub} />
          <Text style={st.devSmall}>소리</Text>
          <Text style={st.devName} numberOfLines={2}>{device}</Text>
        </View>
      </View>
      {/* 대화는 한 문장으로 끝나지 않는다. 전달 직후 바로 다음 말로 이어갈 길을 연다. */}
      <Btn label="다른 말 하기" variant="tonal" icon="mic" onPress={onNext} style={{ marginTop: 14 }} />
    </View>
  )
}

/* ── ⑦ 인식 실패 / 복구 (2회 실패 시 순서만 바뀐다) ──────── */
export function FailScreen({
  retries, onRetry, onType,
}: { retries: number; onRetry: () => void; onType: () => void }) {
  const twice = retries >= 2
  const actions = twice
    // 반복 실패 시 성공 확률이 높은 경로를 위로 올린다. 다시 말하기를 없애지는 않는다.
    ? [
      { label: '직접 입력', icon: 'type', on: onType },
      { label: '다시 말하기', icon: 'redo', on: onRetry },
    ]
    : [
      { label: '다시 말하기', icon: 'redo', on: onRetry },
      { label: '직접 입력', icon: 'type', on: onType },
    ]
  return (
    <View style={layout.body}>
      <View style={st.failHead}>
        {twice ? (
          <View style={st.retryTag}>
            <Icon name="warn" size={16} color={C.warn} />
            <Text style={st.retryTagTx}>다시 말하기 {retries}회</Text>
          </View>
        ) : (
          <View style={st.warnIc}><Icon name="warn" size={38} color={C.warn} /></View>
        )}
        {/* 사과도 자책 유도도 없이 사실만 말한다 */}
        <Text style={st.failTitle}>{twice ? '이번에도 알아듣지 못했어요' : '잘 알아듣지 못했어요'}</Text>
        <Text style={st.failSub}>{twice ? '자주 쓰는 문장이 더 빠를 수 있어요' : '다른 방법으로 전달할 수 있어요'}</Text>
      </View>
      <Spacer />
      <View style={layout.stack}>
        {actions.map(a => (
          <Btn key={a.label} label={a.label} variant="tonal" icon={a.icon as any} onPress={a.on} />
        ))}
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  appbarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  txtBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12 },
  txtBtnTx: { fontSize: 16, fontWeight: W.bold, color: C.sub },
  backPlain: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },

  quickBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    backgroundColor: C.accTint, borderWidth: 2, borderColor: C.acc, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  quickTx: { flex: 1, fontSize: 15, fontWeight: W.bold, color: C.acc },
  quickPause: { fontSize: 15, fontWeight: W.extra, color: C.acc, textDecorationLine: 'underline' },

  quickSuggest: {
    marginTop: 12, gap: 12, backgroundColor: C.accTint, borderWidth: 2, borderColor: C.acc,
    borderRadius: 16, padding: 16,
  },
  quickSuggestTx: { fontSize: 16, fontWeight: W.bold, color: C.ink, lineHeight: 24 },

  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: C.soft, borderRadius: 12, borderWidth: 1, borderColor: C.line,
  },
  noticeTx: { flex: 1, fontSize: 13.5, color: C.sub, lineHeight: 19 },

  chipsScroll: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: 12, marginTop: 14, paddingRight: 24, alignItems: 'center' },

  micWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 26 },
  micBtn: {
    width: S.micSize, height: S.micSize, borderRadius: S.micSize / 2,
    backgroundColor: C.accFill,
    alignItems: 'center', justifyContent: 'center', gap: 10,
    // 테두리 없이 그림자만으로 라벤더 배경에서 떠 보이게 한다 (참고 시안과 동일)
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }, elevation: 7,
  },
  micLabel: { fontSize: S.micLabel, fontWeight: W.extra, color: C.onAcc },

  listenTitle: { fontSize: 28, fontWeight: W.extra, color: C.ink },
  listenSub: { fontSize: 18, color: C.sub, marginTop: 8 },
  rippleWrap: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute', width: S.micSize, height: S.micSize, borderRadius: S.micSize / 2,
    backgroundColor: C.accShadow,
  },

  candSingle: {
    marginTop: 22, borderWidth: 1.5, borderColor: C.acc, borderRadius: 18,
    paddingVertical: 34, paddingHorizontal: 26, minHeight: S.candSingleMin,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  candSingleTx: {
    fontSize: S.candSingleFont, fontWeight: W.extra, lineHeight: S.candSingleFont * 1.5,
    textAlign: 'center', color: C.ink,
  },
  hintCenter: { fontSize: 15, color: C.sub, textAlign: 'center', marginTop: 12 },

  bigSayWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, paddingVertical: 8 },
  bigSay: {
    // 받침 있는 한글은 행 높이가 1.32배면 아래가 잘린다. 1.45배로 넉넉히 준다.
    // includeFontPadding까지 켜야 안드로이드에서 위아래가 안 깎인다.
    fontSize: S.bigSay, fontWeight: W.black, lineHeight: S.bigSay * 1.45,
    textAlign: 'center', letterSpacing: -0.5, color: C.ink, includeFontPadding: true,
  },
  zoomHintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 14 },
  zoomHintTx: { fontSize: 13.5, color: C.sub, fontWeight: W.bold },
  // 대면 모드 — 흰 바탕에 문장만. 상대가 한 걸음 떨어져서도 읽도록 화면을 통째로 쓴다.
  zoomWrap: {
    flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20, paddingVertical: 30,
  },
  zoomTx: {
    fontSize: S.bigSay * 1.35, fontWeight: W.black, lineHeight: S.bigSay * 1.35 * 1.4,
    textAlign: 'center', letterSpacing: -0.5, color: C.ink, includeFontPadding: true,
  },
  zoomClose: { position: 'absolute', bottom: 26, fontSize: 14, color: C.sub, fontWeight: W.bold },

  sayRow: { flexDirection: 'row', gap: 14, alignItems: 'stretch' },
  devBox: {
    width: 124, borderRadius: 16, backgroundColor: C.soft,
    alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 10, paddingHorizontal: 6,
  },
  devSmall: { fontSize: 13, fontWeight: W.bold, color: C.sub },
  devName: { fontSize: 15, fontWeight: W.extra, color: C.ink, textAlign: 'center', lineHeight: 20 },

  failHead: { alignItems: 'center', gap: 12, marginTop: 44 },
  warnIc: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: C.warnBg,
    alignItems: 'center', justifyContent: 'center',
  },
  retryTag: {
    flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.warnBg,
    borderRadius: 999, paddingVertical: 7, paddingHorizontal: 15,
  },
  retryTagTx: { fontSize: 15, fontWeight: W.extra, color: C.warn },
  failTitle: { fontSize: 26, fontWeight: W.extra, color: C.ink, textAlign: 'center' },
  failSub: { fontSize: 18, color: C.sub, textAlign: 'center' },
})
