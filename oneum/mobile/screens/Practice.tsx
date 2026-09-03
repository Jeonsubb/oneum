/** 연습 모드 ⑮ ⑩ ⑪ ⑫ 와 빠른 발화 ⑭ ⑭′ — 목업 ROW E·F.
 *
 *  "연습이 곧 등록"(SF-13): 이 경로에서 검증·사전 승인된 문장만 빠른 발화 대상이 된다.
 *  점수·등급·streak·랭킹을 두지 않는다(BC-08) — 진행성 질환 사용자에게 명료도 하락이
 *  '실패'로 보이지 않게 하기 위해서다.
 */
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Icon } from '../components/Icon'
import { AppBar, Btn, C, SilenceBadge, Spacer, layout } from '../components/ui'
import { S, W } from '../lib/theme'

/* ── ⑮ 연습 녹음 분리 동의 (최초 1회) ────────────────────── */
/** BC-07 — 기기 내 검증·적응 학습·연구 보관을 각각 따로 묻고 필수 동의와 묶지 않는다.
 *  기본은 기기 내 저장이며 녹음의 주인은 사용자다. */
export type ConsentKey = 'verify' | 'adapt' | 'research'
export const CONSENT_ITEMS: { key: ConsentKey; title: string; desc: string; required: boolean }[] = [
  { key: 'verify', title: '이 기기에서 문장별 인식 확인', desc: '녹음은 휴대폰 안에만 저장됩니다. 이 항목을 꺼도 연습은 할 수 있어요.', required: false },
  { key: 'adapt', title: '내 발음에 맞추는 학습', desc: '연습 결과로 후보 순서를 나에게 맞춥니다. 녹음은 기기 밖으로 나가지 않습니다.', required: false },
  { key: 'research', title: '서비스 개선 연구 보관', desc: '동의하면 익명 처리 후 보관합니다. 끄셔도 모든 기능을 그대로 쓸 수 있어요.', required: false },
]

export function ConsentScreen({
  value, onToggle, onDone, onBack,
}: {
  value: Record<ConsentKey, boolean>
  onToggle: (k: ConsentKey) => void
  onDone: () => void
  onBack: () => void
}) {
  return (
    <View style={layout.body}>
      <AppBar title="연습 녹음 동의" onBack={onBack} />
      <Text style={st.consentLead}>
        연습에서 만들어지는 녹음을 어디까지 쓸지 따로 정합니다.{'\n'}
        모두 꺼도 연습과 등록은 그대로 됩니다.
      </Text>
      <ScrollView style={{ marginTop: 18 }} contentContainerStyle={{ gap: 14 }}>
        {CONSENT_ITEMS.map(it => {
          const on = value[it.key]
          return (
            <Pressable key={it.key} onPress={() => onToggle(it.key)}
              accessibilityRole="switch" accessibilityState={{ checked: on }}
              accessibilityLabel={`${it.title}, ${on ? '동의함' : '동의 안 함'}`}
              style={[st.consentCard, on && { borderColor: C.acc, backgroundColor: C.accTint }]}>
              <View style={[st.checkbox, on && { backgroundColor: C.accFill, borderColor: C.accEdge }]}>
                {on && <Icon name="check" size={20} color={C.onAcc} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.consentTitle}>{it.title}</Text>
                <Text style={st.consentDesc}>{it.desc}</Text>
              </View>
            </Pressable>
          )
        })}
      </ScrollView>
      <Btn label="이대로 시작하기" icon="check" onPress={onDone} style={{ marginTop: 14 }} />
    </View>
  )
}

/* ── ⑩ 연습 홈 ───────────────────────────────────────────── */
export type PracticeSet = {
  name: string
  kind: 'situation' | 'reading'   // 상황 연습(짧은 실용문) vs 읽기 연습(긴 지문·발성)
  situation?: string              // 상황 연습에서만 쓴다
  sentences: string[]             // 실제로 읽을 문장들
  total: number
  verified: number                // 상황: 등록 수 / 읽기: 항상 0(등록 대상 아님)
  draft: boolean
}

/** 카드에 보이는 유일한 숫자는 '등록 커버리지'다. streak·랭킹·등급은 두지 않는다.
 *  세트 구성은 언어재활사 자문 귀속(BC-08)이며, 자문 전 세트는 "초안"임을 숨기지 않는다. */
export function PracticeHomeScreen({
  sets, onStart, onHistory, onManage,
}: { sets: PracticeSet[]; onStart: (s: PracticeSet) => void; onHistory: () => void; onManage: () => void }) {
  const situationSets = sets.filter(s => s.kind === 'situation')
  const readingSets = sets.filter(s => s.kind === 'reading')

  const card = (s: PracticeSet) => (
    <View key={s.name} style={st.setCard}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={st.setName}>{s.name}</Text>
          {s.draft && <Text style={st.draftTag}>초안</Text>}
        </View>
        {/* 상황 연습은 '등록 커버리지', 읽기 연습은 '문장 수'만 보여준다 (등급·점수 없음) */}
        {s.kind === 'situation' ? (
          <>
            <Text style={st.setMeta}>등록됨 {s.verified} / {s.total}문장</Text>
            <View style={st.pbar}>
              <View style={[st.pbarFill, { width: `${s.total ? (s.verified / s.total) * 100 : 0}%` }]} />
            </View>
          </>
        ) : (
          <Text style={st.setMeta}>{s.total}문장 · 소리 내어 읽기</Text>
        )}
      </View>
      <Btn label="시작" onPress={() => onStart(s)} style={{ width: 96, minHeight: 64 }} />
    </View>
  )

  return (
    <View style={layout.body}>
      <AppBar title="연습" />
      <ScrollView style={{ marginTop: 14 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
        <Text style={st.sectionHead}>상황 연습</Text>
        <Text style={st.sectionSub}>실제로 쓰는 짧은 문장을 연습하고, 빠른 발화로 등록합니다.</Text>
        {situationSets.map(card)}

        <Text style={[st.sectionHead, { marginTop: 20 }]}>읽기 연습</Text>
        <Text style={st.sectionSub}>시·뉴스 같은 긴 글을 소리 내어 읽으며 발음을 가다듬습니다. 점수도 등급도 없습니다.</Text>
        {readingSets.map(card)}
      </ScrollView>
      <Btn label="내 표현 등록·정리" variant="outline" icon="plus" onPress={onManage}
        style={{ marginTop: 8 }} />
      <Btn label="빠른 발화 기록 보기" variant="outline" icon="redo" onPress={onHistory}
        style={{ marginTop: 10 }} />
    </View>
  )
}

/* ── 빠른 발화 기록 (QA-07 측정 원천 열람) ─────────────────── */
/** 즉시 발화·강등·취소가 각각 몇 번이었는지 사용자가 직접 확인한다.
 *  "게이트보다 위험하지 않다"는 QA-07 기준을 사용자가 눈으로 검증할 수 있게 하는 창구. */
export function QuickHistoryScreen({
  events, onBack,
}: {
  events: { type: 'fired' | 'demoted' | 'undone'; text: string; at: number }[]
  onBack: () => void
}) {
  const label = { fired: '즉시 발화', demoted: '게이트로', undone: '취소함' } as const
  const fired = events.filter(e => e.type === 'fired').length
  const undone = events.filter(e => e.type === 'undone').length
  return (
    <View style={layout.body}>
      <AppBar title="빠른 발화 기록" onBack={onBack} />
      <View style={st.histSummary}>
        <Text style={st.histSummaryTx}>
          즉시 발화 {fired}번 중 취소 {undone}번{'\n'}
          {fired > 0 ? `(취소율 ${Math.round((undone / fired) * 100)}%)` : '아직 즉시 발화 기록이 없어요'}
        </Text>
      </View>
      <ScrollView style={{ marginTop: 14 }} contentContainerStyle={{ gap: 8 }}>
        {events.length === 0 && (
          <Text style={st.histEmpty}>빠른 발화를 쓰면 여기에 기록이 쌓입니다.</Text>
        )}
        {events.map((e, i) => (
          <View key={i} style={st.histRow}>
            <Text style={[st.histTag,
              e.type === 'undone' && { color: C.warn, backgroundColor: C.warnBg },
              e.type === 'fired' && { color: C.acc, backgroundColor: C.accTint }]}>
              {label[e.type]}
            </Text>
            <Text style={st.histText} numberOfLines={1}>{e.text}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

/* ── ⑪ 연습 진행 ─────────────────────────────────────────── */
/** 한 화면에 한 문장, 시간 제한 없음. 문장당 3회 중 마지막 1회만 "평소처럼" 발화를 유도한다
 *  — 연습(최대 수행) 발화와 실전 발화의 음향 불일치를 줄이기 위한 장치(미해결 쟁점 1 대응).
 *  건너뛰기는 항상 열려 있다. */
export function PracticeRunScreen({
  sentence, index, total, round, onRecord, onSkip, onBack, recording,
}: {
  sentence: string
  index: number
  total: number
  round: 1 | 2 | 3
  onRecord: () => void
  onSkip: () => void
  onBack: () => void
  recording?: boolean
}) {
  const natural = round === 3
  return (
    <View style={layout.body}>
      <AppBar title={`${index + 1} / ${total}`} onBack={onBack} />
      <SilenceBadge />
      <View style={st.roundRow}>
        {[1, 2, 3].map(r => (
          <View key={r} style={[st.roundDot, r <= round && { backgroundColor: C.accFill, borderColor: C.accEdge }]} />
        ))}
        <Text style={st.roundTx}>{round}번째 / 3번</Text>
      </View>

      <View style={st.sentenceBox}><Text style={st.sentenceTx}>{sentence}</Text></View>

      {natural && (
        <View style={st.naturalTip}>
          <Icon name="mic" size={18} color={C.acc} />
          <Text style={st.naturalTx}>이번엔 <Text style={{ fontWeight: W.extra }}>평소처럼</Text> 편하게 말해주세요</Text>
        </View>
      )}

      <Spacer />
      <View style={layout.stack}>
        <Btn label={recording ? '말하는 중… 눌러서 끝내기' : '눌러서 읽기'} icon="mic" xl onPress={onRecord} />
        <Btn label="이 문장 건너뛰기" variant="outline" onPress={onSkip} />
      </View>
    </View>
  )
}

/* ── ⑫ 연습 결과 ─────────────────────────────────────────── */
/** 점수·백분율·그래프 없이 "앱이 알아들은 원문"을 그대로 보여준다(BC-08).
 *  등록은 자동이 아니라 명시적 버튼 — 사전 승인(DD-05 조건 1)이다. */
export function PracticeResultScreen({
  sentence, heard, matched, passed, canRegister = true, onRegister, onRetry, onNext,
}: {
  sentence: string
  heard: string[]
  /** 회차별 검증 통과 여부 — 정확 일치가 아니라 자모 유사도 기준(조사·어미 차이 허용) */
  matched?: boolean[]
  passed: boolean
  /** 읽기 연습(발성)에서는 빠른 발화 등록 대상이 아니므로 등록 버튼을 숨긴다 */
  canRegister?: boolean
  onRegister: () => void
  onRetry: () => void
  onNext: () => void
}) {
  return (
    <View style={layout.body}>
      <Text style={layout.hQ}>앱이 이렇게 알아들었어요</Text>
      <View style={st.targetBox}>
        <Text style={st.targetLabel}>읽은 문장</Text>
        <Text style={st.targetTx}>{sentence}</Text>
      </View>
      <ScrollView style={{ marginTop: 14 }} contentContainerStyle={{ gap: 10 }}>
        {heard.map((h, i) => (
          <View key={i} style={[st.heardRow, (matched ? matched[i] : h === sentence) && { borderColor: C.acc, backgroundColor: C.accTint }]}>
            <Text style={st.heardIdx}>{i + 1}번째</Text>
            <Text style={st.heardTx}>{h || '(인식하지 못했어요)'}</Text>
          </View>
        ))}
      </ScrollView>

      <Spacer />
      {passed && canRegister ? (
        <View style={layout.stack}>
          {/* 사전 승인은 자동이 아니라 사용자의 명시적 행동이어야 한다 */}
          <Btn label="이 문장 빠른 발화로 등록" icon="check" xl onPress={onRegister} />
          <Btn label="지금은 안 할래요" variant="outline" onPress={onNext} />
        </View>
      ) : passed && !canRegister ? (
        <View style={layout.stack}>
          {/* 읽기 연습 — 등록 대상이 아니라 발성 연습이므로 다음으로만 넘어간다 */}
          <Text style={st.readOk}>잘 읽으셨어요</Text>
          <Btn label="다음 문장" icon="redo" xl onPress={onNext} />
        </View>
      ) : (
        <View style={layout.stack}>
          {/* 통과가 어려우면 실패로 규정하지 않고 다음으로 넘어갈 길을 연다 */}
          <Text style={st.notPassed}>아직 문장이 안정적으로 들리지 않아요. 다음에 다시 해도 됩니다.</Text>
          <Btn label="한 번 더 읽기" variant="tonal" icon="redo" onPress={onRetry} />
          <Btn label="다음 문장으로" variant="outline" onPress={onNext} />
        </View>
      )}
    </View>
  )
}

/* ── ⑭ 빠른 발화 미리보기 (0.5초) ────────────────────────── */
/** 회수 불가 위험의 사전 차단(DD-05) — 소리가 나가기 전 마지막 0.5초의 침묵.
 *  여기서 취소하면 무음으로 중단된다. 빠른 발화조차 "보여주고 나서 말한다". */
export function QuickPreviewScreen({ text, onFire, onCancel }: { text: string; onFire: () => void; onCancel: () => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    timer.current = setTimeout(onFire, 500)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [onFire])
  return (
    <View style={layout.body}>
      <View style={st.previewTag}>
        <Icon name="vol" size={18} color={C.acc} />
        <Text style={st.previewTagTx}>곧 소리로 말합니다</Text>
      </View>
      <View style={st.bigWrap}><Text style={st.bigTx}>{text}</Text></View>
      <Btn label="취소" variant="outline" icon="x" xl
        onPress={() => { if (timer.current) clearTimeout(timer.current); onCancel() }} />
    </View>
  )
}

/* ── ⑭′ 재생 + 취소 3초 (안전 화면) ──────────────────────── */
/** 재생 후에도 3초의 취소권(QA-07). 취소는 상대에게 "방금 문장은 취소합니다"로 정직하게 표시되고,
 *  오발화 문장은 빠른 발화에서 자동 잠금된다 — 재검증으로만 해제. */
export function QuickPlayingScreen({
  text, onUndo, onDone,
}: { text: string; onUndo: () => void; onDone: () => void }) {
  const [left, setLeft] = useState(3)
  const [undone, setUndone] = useState(false)
  useEffect(() => {
    if (undone) return
    if (left <= 0) { onDone(); return }
    const t = setTimeout(() => setLeft(l => l - 1), 1000)
    return () => clearTimeout(t)
  }, [left, undone, onDone])

  if (undone) {
    return (
      <View style={layout.body}>
        <View style={st.bigWrap}>
          <Text style={[st.bigTx, { color: C.warn }]}>방금 문장은{'\n'}취소합니다</Text>
        </View>
        <Btn label="닫기" onPress={onDone} xl />
      </View>
    )
  }
  return (
    <View style={layout.body}>
      <View style={st.bigWrap}><Text style={st.bigTx}>{text}</Text></View>
      {/* 취소 버튼은 재생 후에도 3초 이상 유지되는 대형 타깃이다 */}
      <Btn label={`방금 문장 취소 (${left})`} variant="tonal" icon="x" xl
        onPress={() => { setUndone(true); onUndo() }} />
    </View>
  )
}

const st = StyleSheet.create({
  histSummary: {
    marginTop: 16, backgroundColor: C.soft, borderRadius: 16, borderWidth: 1.5, borderColor: C.line,
    padding: 18,
  },
  histSummaryTx: { fontSize: 17, fontWeight: W.bold, color: C.ink, lineHeight: 26 },
  histEmpty: { fontSize: 16, color: C.sub, textAlign: 'center', marginTop: 30, lineHeight: 24 },
  histRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52,
    borderWidth: 1.5, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, backgroundColor: '#fff',
  },
  histTag: {
    fontSize: 13.5, fontWeight: W.extra, color: C.sub, backgroundColor: C.soft,
    borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10, overflow: 'hidden', width: 78, textAlign: 'center',
  },
  histText: { flex: 1, fontSize: 17, fontWeight: W.bold, color: C.ink },
  consentLead: { fontSize: 17, color: C.sub, marginTop: 14, lineHeight: 26 },
  consentCard: {
    flexDirection: 'row', gap: 14, alignItems: 'flex-start',
    borderWidth: 2, borderColor: C.line, borderRadius: 16, padding: 16, backgroundColor: '#fff',
  },
  checkbox: {
    width: 32, height: 32, borderRadius: 8, borderWidth: 2, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  consentTitle: { fontSize: 18, fontWeight: W.extra, color: C.ink },
  consentDesc: { fontSize: 15, color: C.sub, marginTop: 4, lineHeight: 22 },

  practiceLead: { fontSize: 17, color: C.sub, marginTop: 14, lineHeight: 26 },
  sectionHead: { fontSize: 20, fontWeight: W.extra, color: C.ink, marginTop: 4 },
  sectionSub: { fontSize: 14.5, color: C.sub, lineHeight: 21, marginBottom: 4 },
  readOk: { fontSize: 18, fontWeight: W.bold, color: C.acc, textAlign: 'center' },
  setCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 2, borderColor: C.line, borderRadius: 16, padding: 16, backgroundColor: '#fff',
  },
  setName: { fontSize: 20, fontWeight: W.extra, color: C.ink },
  draftTag: {
    fontSize: 13, fontWeight: W.bold, color: C.warn, backgroundColor: C.warnBg,
    borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, overflow: 'hidden',
  },
  setMeta: { fontSize: 15, color: C.sub, marginTop: 4 },
  pbar: { height: 10, borderRadius: 5, backgroundColor: C.soft, borderWidth: 1, borderColor: C.line, overflow: 'hidden', marginTop: 8 },
  pbarFill: { height: '100%', backgroundColor: C.accFill, borderRadius: 5 },

  roundRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  roundDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: C.line, backgroundColor: '#fff' },
  roundTx: { fontSize: 15, fontWeight: W.bold, color: C.sub, marginLeft: 6 },
  sentenceBox: {
    marginTop: 18, borderWidth: 2.5, borderColor: C.acc, borderRadius: 20,
    paddingVertical: 30, paddingHorizontal: 24, minHeight: 170,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  sentenceTx: { fontSize: 30, fontWeight: W.extra, lineHeight: 45, textAlign: 'center', color: C.ink },
  naturalTip: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14,
    backgroundColor: C.accTint, borderRadius: 14, padding: 14,
  },
  naturalTx: { flex: 1, fontSize: 16, color: C.ink, lineHeight: 23 },

  targetBox: { marginTop: 18, borderWidth: 2, borderColor: C.line, borderRadius: 16, padding: 16, backgroundColor: C.soft },
  targetLabel: { fontSize: 14, fontWeight: W.bold, color: C.sub },
  targetTx: { fontSize: 22, fontWeight: W.extra, color: C.ink, marginTop: 6, lineHeight: 31 },
  heardRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 2, borderColor: C.line, borderRadius: 14, padding: 14, backgroundColor: '#fff',
  },
  heardIdx: { fontSize: 14, fontWeight: W.bold, color: C.sub, width: 58 },
  heardTx: { flex: 1, fontSize: 19, fontWeight: W.bold, color: C.ink, lineHeight: 27 },
  notPassed: { fontSize: 16, color: C.sub, lineHeight: 24, textAlign: 'center' },

  previewTag: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6,
    backgroundColor: C.accTint, borderWidth: 2, borderColor: C.acc, borderRadius: 999,
    paddingVertical: 8, paddingHorizontal: 16,
  },
  previewTagTx: { fontSize: 15, fontWeight: W.extra, color: C.acc },
  bigWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  bigTx: { fontSize: S.bigSay, fontWeight: W.black, lineHeight: S.bigSay * 1.32, textAlign: 'center', color: C.ink },
})
