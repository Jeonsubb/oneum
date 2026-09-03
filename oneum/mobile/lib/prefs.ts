/** 앱 설정 — 재시작해도 유지되어야 하는 사용자 선택. 전부 기기 내 저장(QA-05). */
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'oneum.prefs.v1'

export interface Prefs {
  quickOn: boolean          // 빠른 발화 전역 on/off (기본 OFF, DD-05)
  highContrast: boolean     // 고대비(노랑) 테마 — 저시력 접근성
}

const DEFAULTS: Prefs = { quickOn: false, highContrast: false }

export async function loadPrefs(): Promise<Prefs> {
  const raw = await AsyncStorage.getItem(KEY)
  return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
}

export async function savePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = { ...(await loadPrefs()), ...patch }
  await AsyncStorage.setItem(KEY, JSON.stringify(next))
  return next
}
