export interface Candidate {
  text: string
  confidence: number
}

export async function recognize(audio: Blob): Promise<{ status: string; candidates: Candidate[] }> {
  const form = new FormData()
  form.append('audio', audio, 'utterance.wav')
  const res = await fetch('/api/recognize', { method: 'POST', body: form })
  if (!res.ok) throw new Error(`인식 요청 실패 (${res.status})`)
  return res.json()
}

// Azure TTS 우선, 실패(목 모드 등) 시 브라우저 내장 합성으로 폴백
export async function speak(text: string): Promise<void> {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) throw new Error('tts fallback')
    const audio = new Audio(URL.createObjectURL(await res.blob()))
    await audio.play()
  } catch {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'ko-KR'
    u.rate = 0.95
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  }
}
