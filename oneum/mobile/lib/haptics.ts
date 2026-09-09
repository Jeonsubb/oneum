/** 햅틱 — 아이폰다움의 절반은 손끝 촉감이다. 효과음(sfx)과 나란히, 상태 전환의
 *  주요 지점에서만 가볍게 울린다. 남발하면 촉감이 소음이 된다.
 *
 *  손 감각이 저하된 사용자도 있으므로 햅틱은 보조 신호일 뿐, 유일한 신호로 쓰지 않는다
 *  (화면 변화·효과음이 항상 함께 간다).
 */
import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'

const on = Platform.OS === 'ios'

/** 녹음 시작·종료 — 중간 세기의 탁 */
export function hapticRecord() {
  if (on) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
}

/** 문장 확정 — 성공 노티피케이션 패턴 (두 번 톡톡) */
export function hapticConfirm() {
  if (on) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}

/** 탭 전환·선택 — 가장 가벼운 틱 */
export function hapticSelect() {
  if (on) Haptics.selectionAsync().catch(() => {})
}
