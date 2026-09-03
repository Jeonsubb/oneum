import { useRef, useState } from 'react'
import './App.css'
import { recognize, speak, type Candidate } from './lib/api'
import { WavRecorder } from './lib/recorder'

// 확정 게이트 임계값 — 보정 전 임시값 (당사자 검증 발화로 보정 예정)
const GATE_THRESHOLD = 0.45

// 즐겨찾기 자리표시 — 다음 단계에서 개인 프로필(기기 내 저장)로 대체
const FALLBACK_PHRASES = ['물 한 잔 주세요', '화장실이 어디예요?', '천천히 말씀해 주세요']

type Phase = 'idle' | 'recording' | 'processing' | 'choose' | 'failed' | 'confirmed'

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [confirmed, setConfirmed] = useState('')
  const [directInput, setDirectInput] = useState('')
  const [error, setError] = useState('')
  const recorder = useRef<WavRecorder | null>(null)

  async function startRecording() {
    setError('')
    try {
      recorder.current = new WavRecorder()
      await recorder.current.start()
      setPhase('recording')
    } catch {
      setError('마이크를 사용할 수 없어요. 권한을 확인해 주세요.')
    }
  }

  async function stopRecording() {
    if (!recorder.current) return
    setPhase('processing')
    try {
      const wav = await recorder.current.stop()
      const result = await recognize(wav)
      if (result.status !== 'Success' || result.candidates.length === 0) {
        setCandidates([])
        setPhase('failed')
        return
      }
      setCandidates(result.candidates.slice(0, 3))
      setPhase(result.candidates[0].confidence >= GATE_THRESHOLD ? 'choose' : 'failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류가 발생했어요')
      setPhase('idle')
    }
  }

  function confirm(text: string) {
    setConfirmed(text)
    setPhase('confirmed')
  }

  function reset() {
    setCandidates([])
    setConfirmed('')
    setDirectInput('')
    setPhase('idle')
  }

  return (
    <main className="app">
      {phase === 'idle' && (
        <>
          <h1 className="logo">온음</h1>
          <p className="hint">버튼을 누르고 한 문장을 말해 주세요</p>
          <button className="mic" onClick={startRecording}>🎤 말하기</button>
          {error && <p className="error">{error}</p>}
        </>
      )}

      {phase === 'recording' && (
        <>
          <p className="hint recording-dot">듣고 있어요…</p>
          <button className="mic stop" onClick={stopRecording}>■ 다 말했어요</button>
        </>
      )}

      {phase === 'processing' && <p className="hint">알아듣는 중…</p>}

      {(phase === 'choose' || phase === 'failed') && (
        <>
          {phase === 'failed' && <p className="notice">인식하지 못했어요. 이 중에 있나요?</p>}
          {phase === 'choose' && <p className="hint">이 말이 맞나요?</p>}
          <div className="candidates">
            {candidates.map((c, i) => (
              <button
                key={i}
                className={i === 0 && phase === 'choose' ? 'candidate primary' : 'candidate'}
                onClick={() => confirm(c.text)}
              >
                {c.text}
              </button>
            ))}
          </div>
          <div className="recovery">
            <button onClick={startRecording}>🎤 다시 말하기</button>
            {FALLBACK_PHRASES.map((p) => (
              <button key={p} onClick={() => confirm(p)}>⭐ {p}</button>
            ))}
            <div className="direct">
              <input
                value={directInput}
                placeholder="직접 입력"
                onChange={(e) => setDirectInput(e.target.value)}
              />
              <button disabled={!directInput.trim()} onClick={() => confirm(directInput.trim())}>
                확정
              </button>
            </div>
          </div>
        </>
      )}

      {phase === 'confirmed' && (
        <>
          <div className="display" role="status">{confirmed}</div>
          <div className="actions">
            <button className="speak" onClick={() => speak(confirmed)}>🔊 소리로 전달</button>
            <button onClick={reset}>새로 말하기</button>
          </div>
        </>
      )}
    </main>
  )
}
