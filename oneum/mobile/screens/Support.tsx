/** 보조 화면 ⑤ ⑧ ⑨ — 후보 수정 · 즐겨찾기 · 내 표현 등록(온보딩). */
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Icon } from '../components/Icon'
import { AppBar, Btn, C, Chip, Spacer, layout } from '../components/ui'
import { S, W } from '../lib/theme'
import { SITUATIONS, Situation } from './Core'

/* ── ⑤ 후보 수정 ─────────────────────────────────────────── */
/** 틀린 후보를 버리지 않고 고쳐 쓰게 한다 — 처음부터 다시 말하는 비용을 없앤다.
 *  확정 버튼은 키보드 바로 위(엄지 거리 안)에 고정한다. */
export function EditScreen({
  initial, onConfirm, onBack,
}: { initial: string; onConfirm: (t: string) => void; onBack: () => void }) {
  const [text, setText] = useState(initial)
  return (
    <View style={[layout.body, { paddingBottom: 0 }]}>
      <AppBar title="문장 고치기" onBack={onBack} />
      <Text style={st.editHint}>고른 문장을 필요한 만큼만 고치세요</Text>
      <TextInput
        style={st.editField}
        value={text}
        onChangeText={setText}
        multiline
        autoFocus
        accessibilityLabel="문장 고치기 입력란"
        selectionColor={C.acc}
      />
      <Spacer />
      <Btn label="확정" icon="check" onPress={() => onConfirm(text.trim())}
        disabled={!text.trim()} style={{ minHeight: 76, marginBottom: 16 }} />
    </View>
  )
}


/* ── ⑨ 내 표현 등록 (온보딩) ─────────────────────────────── */
/** Relate의 500문장 녹음 훈련과 정반대 — "녹음 없음"을 화면 문구로 보여준다.
 *  기본 경로는 타이핑이 아니라 추천 문장 탭 1회로 담기(손떨림·소근육 저하 배려). */
export function OnboardScreen({
  presets, picked, registered, onToggle, onAddCustom, onRemove, onDone, onBack,
}: {
  presets: { text: string; situation: Situation }[]
  picked: Set<string>
  registered: { id: string; text: string; situation: Situation }[]
  onToggle: (t: string) => void
  onAddCustom: (t: string, s: Situation) => void
  onRemove: (id: string) => void
  onDone: () => void
  onBack?: () => void
}) {
  const [draft, setDraft] = useState('')
  const [sit, setSit] = useState<Situation>('일상')
  const target = 20
  return (
    <View style={layout.body}>
      <AppBar title="내 표현 등록" onBack={onBack} />

      <View style={st.notice}>
        <Icon name="check" size={30} color={C.acc} />
        <View style={{ flex: 1 }}>
          <Text style={st.noticeB}>녹음 없이, 골라 담거나 적기만 하면 됩니다</Text>
          <Text style={st.noticeS}>자주 쓰는 문장을 미리 담아두면 인식이 흔들려도 그 문장이 후보에 먼저 올라옵니다.</Text>
        </View>
      </View>

      <View style={st.progress}>
        <Text style={st.progressB}>{picked.size} / {target}</Text>
        <View style={st.pbar}>
          <View style={[st.pbarFill, { width: `${Math.min(100, (picked.size / target) * 100)}%` }]} />
        </View>
      </View>

      <ScrollView style={{ marginTop: 14 }} contentContainerStyle={{ gap: 10 }}>
        {presets.map(p => {
          const added = picked.has(p.text)
          return (
            <View key={p.text} style={[st.preset, added && st.presetAdded]}>
              <Text style={st.presetTx}>{p.text}</Text>
              <Text style={[st.presetSit, added && { backgroundColor: '#fff' }]}>{p.situation}</Text>
              <Pressable onPress={() => onToggle(p.text)}
                accessibilityRole="button"
                accessibilityLabel={added ? `${p.text} 담기 취소` : `${p.text} 담기`}
                style={[st.pkBtn, added ? st.pkBtnOn : st.pkBtnOff]}>
                <Icon name={added ? 'check' : 'plus'} size={16} color={added ? C.onAcc : C.ink} />
                <Text style={[st.pkTx, added && { color: C.onAcc }]}>{added ? '담김' : '담기'}</Text>
              </Pressable>
            </View>
          )
        })}

        {/* 이미 등록한 내 문장 — 여기서 지울 수 있다(즐겨찾기 대신 정리 창구). 대화 중이 아니라
            등록 화면에서만 삭제 가능하게 해 실수 삭제를 막는다(SF-01). */}
        {registered.length > 0 && (
          <>
            <Text style={st.regHead}>이미 등록한 내 문장 ({registered.length})</Text>
            {registered.map(r => (
              <View key={r.id} style={st.regRow}>
                <Text style={st.regTx}>{r.text}</Text>
                <Text style={st.presetSit}>{r.situation}</Text>
                <Pressable onPress={() => onRemove(r.id)} style={st.regDel}
                  accessibilityRole="button" accessibilityLabel={`${r.text} 삭제`}>
                  <Icon name="x" size={18} color={C.warn} />
                </Pressable>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <View style={st.addRow}>
        <TextInput style={st.field} value={draft} onChangeText={setDraft}
          placeholder="직접 문장 적기" placeholderTextColor="#6B6F75"
          accessibilityLabel="직접 문장 적기" />
        <Btn label="추가" onPress={() => { if (draft.trim()) { onAddCustom(draft.trim(), sit); setDraft('') } }}
          disabled={!draft.trim()} style={{ width: 110, minHeight: 64 }} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={st.chipsScroll} contentContainerStyle={[st.chips, { marginTop: 10 }]}>
        {SITUATIONS.map(s => <Chip key={s} label={s} on={s === sit} onPress={() => setSit(s)} />)}
      </ScrollView>

      <Btn label="등록 마치기" icon="check" onPress={onDone} style={{ marginTop: 14 }} />
    </View>
  )
}

const st = StyleSheet.create({
  chipsScroll: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: 12, marginTop: 14, paddingRight: 24, alignItems: 'center' },

  editHint: { fontSize: 16, color: C.sub, marginTop: 12 },
  editField: {
    marginTop: 18, borderWidth: 2.5, borderColor: C.acc, borderRadius: 18,
    paddingVertical: 22, paddingHorizontal: 20, minHeight: 150,
    fontSize: 26, fontWeight: W.bold, lineHeight: 26 * 1.55, color: C.ink,
    backgroundColor: '#fff', textAlignVertical: 'top',
  },

  regHead: { fontSize: 15, fontWeight: W.extra, color: C.sub, marginTop: 18, marginBottom: 2 },
  regRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56,
    borderWidth: 1.5, borderColor: C.line, borderRadius: 14,
    paddingVertical: 8, paddingRight: 8, paddingLeft: 16, backgroundColor: '#fff',
  },
  regTx: { flex: 1, fontSize: 18, fontWeight: W.bold, lineHeight: 25, color: C.ink },
  regDel: {
    width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: C.warn, backgroundColor: C.warnBg,
  },

  notice: {
    flexDirection: 'row', gap: 14, alignItems: 'flex-start', backgroundColor: C.accTint,
    borderWidth: 2, borderColor: C.acc, borderRadius: 18, padding: 18, marginTop: 20,
  },
  noticeB: { fontSize: 18, fontWeight: W.extra, lineHeight: 26, color: C.ink },
  noticeS: { fontSize: 15, color: C.sub, marginTop: 4, lineHeight: 22 },

  progress: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20 },
  progressB: { fontSize: 19, fontWeight: W.extra, color: C.ink },
  pbar: { flex: 1, height: 10, borderRadius: 5, backgroundColor: C.soft, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  pbarFill: { height: '100%', backgroundColor: C.accFill, borderRadius: 5 },

  preset: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 62,
    borderWidth: 1.5, borderColor: C.line, borderRadius: 14,
    paddingVertical: 8, paddingRight: 10, paddingLeft: 16, backgroundColor: '#fff',
  },
  presetAdded: { borderWidth: 2, borderColor: C.acc, backgroundColor: C.accTint },
  presetTx: { flex: 1, fontSize: 19, fontWeight: W.bold, lineHeight: 25, color: C.ink },
  presetSit: {
    fontSize: 13.5, fontWeight: W.bold, color: C.sub, backgroundColor: C.soft,
    borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10, overflow: 'hidden',
  },
  pkBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 46, paddingHorizontal: 13, borderRadius: 11 },
  pkBtnOff: { borderWidth: 1.5, borderColor: '#75787D', backgroundColor: '#fff' },
  pkBtnOn: { borderWidth: 1.5, borderColor: C.accEdge, backgroundColor: C.accFill },
  pkTx: { fontSize: 15.5, fontWeight: W.extra, color: C.ink },

  addRow: { flexDirection: 'row', gap: 12, marginTop: 16 },
  field: {
    flex: 1, borderWidth: 2, borderColor: '#85888E', borderRadius: 14, minHeight: 64,
    paddingHorizontal: 18, fontSize: 19, color: C.ink,
  },
})
