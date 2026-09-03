import { fetch as expoFetch } from 'expo/fetch'
import { File } from 'expo-file-system'

// 실기기에서는 localhost가 폰 자신을 가리키므로
// .env의 EXPO_PUBLIC_API_URL에 개발 PC의 LAN IP를 넣는다 (예: http://192.168.0.10:8010)
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8010'

export interface Candidate {
  text: string
  confidence: number
}

export async function recognize(
  uri: string,
): Promise<{ status: string; candidates: Candidate[]; mock?: boolean }> {
  // SDK 57의 fetch는 예전 RN 방식의 파일 첨부({uri, name, type} 객체)를 받지 않는다 —
  // 실기기에서 "unsupported FormDataPart implementation"으로 터졌던 원인.
  // 공식 경로는 expo-file-system의 File(Blob 구현체)을 expo/fetch로 보내는 것이다.
  const form = new FormData()
  form.append('audio', new File(uri) as unknown as Blob)
  // 무한 대기 방지 — 셀룰러 등 느린 망에서도 25초면 충분하고, 그 이상은 오류로 취급한다
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 25000)
  try {
    const res = await expoFetch(`${API_BASE}/api/recognize`, {
      method: 'POST', body: form, signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`서버 오류 ${res.status}: ${body.slice(0, 120)}`)
    }
    return await res.json()
  } catch (e) {
    // 어디서 죽었는지 화면에서 볼 수 있게 원인을 살려서 다시 던진다
    if ((e as Error).name === 'AbortError') throw new Error(`시간 초과 (${API_BASE})`)
    throw new Error(`${(e as Error).message} (서버: ${API_BASE})`)
  } finally {
    clearTimeout(timer)
  }
}

/** LLM 의도 복원 (SF-03 slow path) — 저신뢰일 때만 호출한다.
 *  느리거나 실패하면 재정렬 결과만으로 진행해야 하므로 타임아웃을 짧게 잡고 조용히 포기한다.
 *  복원된 문장은 '제안' 라벨로 확정 게이트를 반드시 거친다. */
export async function recover(payload: {
  candidates: Candidate[]
  phrases: string[]
  corrections: Array<{ asr: string; confirmed: string }>
  situation: string
}): Promise<string[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 4000)
  try {
    const res = await fetch(`${API_BASE}/api/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json.suggestions) ? json.suggestions : []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

export interface EngineInfo {
  asr: string
  llm: string
  mock: boolean
}

/** 백엔드가 지금 어떤 엔진을 쓰는지 확인한다.
 *  음성이 외부로 나가는지 여부가 여기서 갈리고, 그 사실을 화면에 고지해야 한다(QA-05). */
export async function fetchEngineInfo(): Promise<EngineInfo | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3000)
    const res = await fetch(`${API_BASE}/healthz`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/** 명세서 QA-05: 클라우드 ASR을 쓰면 전송 사실·처리업체·암호화를 고지한다.
 *  "완전 익명·무저장"은 처리업체 확정 전까지 단정하지 않는다. */
export function privacyNotice(info: EngineInfo | null): string {
  if (!info || info.mock) return '연습용 모드입니다. 음성이 전송되지 않습니다'
  const cloud = info.asr === 'azure' || info.asr === 'ensemble'
  return cloud
    ? '인식을 위해 음성이 Microsoft Azure로 암호화되어 전송됩니다. 등록 문장과 기록은 이 휴대폰에만 저장됩니다'
    : '음성은 연결된 우리 인식 서버에서만 처리됩니다. 등록 문장과 기록은 이 휴대폰에만 저장됩니다'
}
