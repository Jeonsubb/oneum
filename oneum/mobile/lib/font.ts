/** 전역 서체 — KoddiUD 온고딕 (한국장애인개발원 유니버설 디자인 서체).
 *  저시력·고령 사용자의 가독성을 위해 설계된 서체라 이 서비스의 대상과 맞는다.
 *
 *  RN에는 전역 폰트 설정이 없고, 이 서체는 굵기별로 패밀리가 나뉘어 있어(fontWeight로
 *  자동 전환 불가) Text/TextInput을 모듈 수준에서 감싼다: 각 컴포넌트가 스타일에 적어 둔
 *  fontWeight를 읽어 알맞은 face(PostScript 이름)로 치환한다.
 *
 *  주의: 이 파일은 다른 화면 모듈보다 먼저 import되어야 한다 — App.tsx 첫 줄.
 */
import { createElement, forwardRef } from 'react'
import { Platform, StyleSheet } from 'react-native'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RN = require('react-native')

/** 스타일의 fontWeight → 실제 폰트 face. 온고딕은 400/700/800 세 굵기만 있으므로
 *  600은 Bold로, 900은 ExtraBold로 흡수한다. */
function faceFor(w?: string | number): string {
  const n = typeof w === 'string'
    ? (w === 'bold' ? 700 : w === 'normal' ? 400 : parseInt(w, 10) || 400)
    : (w ?? 400)
  if (n >= 800) return 'KoddiUDOnGothic-ExtraBold'
  if (n >= 600) return 'KoddiUDOnGothic-Bold'
  return 'KoddiUDOnGothic-Regular'
}

function patch(name: 'Text' | 'TextInput') {
  const Orig = RN[name]
  const Patched = forwardRef((props: { style?: unknown }, ref) => {
    const flat = (StyleSheet.flatten(props.style as never) ?? {}) as { fontWeight?: string | number }
    return createElement(Orig, {
      ...props, ref,
      // face 이름이 곧 굵기이므로 fontWeight는 normal로 눌러 이중 적용을 막는다
      style: [props.style, { fontFamily: faceFor(flat.fontWeight), fontWeight: 'normal' as const }],
    })
  })
  // react-native 모듈의 export를 바꿔치기 — 이후에 import되는 모든 화면이 이 서체를 쓴다
  Object.defineProperty(RN, name, { configurable: true, get: () => Patched })
}

// 웹(react-native-web) 모듈은 export 재정의를 허용하지 않는다 — 웹 캡처는 CSS @font-face로 해결한다.
if (Platform.OS !== 'web') {
  patch('Text')
  patch('TextInput')
}
