/** 효과음 — 눈으로만 확인하기 어려운 상태 전환(듣기 시작/끝, 확정)을 소리로도 알린다.
 *  구음장애 사용자는 화면과 상대를 번갈아 봐야 하므로, 시선 없이도 앱 상태를 알 수 있어야 한다.
 *  파일은 scripts가 아니라 저장소에 포함된 생성물이다(assets/sounds, 각 0.2초 안팎의 합성음).
 *
 *  주의: 발화 내용을 소리로 만들지는 않는다 — 소리로 말하는 지점은 여전히 확정 후 TTS뿐이다.
 */
import { createAudioPlayer } from 'expo-audio'

// 미리 만들어 두고 재사용한다 — 매번 만들면 첫 재생이 늦는다
const players = {
  start: createAudioPlayer(require('../assets/sounds/start.wav')),
  stop: createAudioPlayer(require('../assets/sounds/stop.wav')),
  confirm: createAudioPlayer(require('../assets/sounds/confirm.wav')),
}

export type SfxName = keyof typeof players

export function playSfx(name: SfxName) {
  try {
    const p = players[name]
    p.seekTo(0)   // 연속 재생을 위해 처음으로 되감는다
    p.play()
  } catch {
    // 효과음은 부가 신호다. 실패해도 본 기능(녹음·인식·발화)을 막지 않는다.
  }
}
