/** 온음 워드마크 — brand/build.py 가 생성한다. 직접 고치지 말 것.
 *  형태를 바꾸려면 brand/build.py 의 상수를 고치고 `python3 build.py` 를 다시 돌린다.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg'

export function Wordmark({ height = 30, color = '#14508C' }: { height?: number; color?: string }) {
  const w = height * 1.3097
  const s = {
    stroke: color, strokeWidth: 22, fill: 'none',
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  return (
    <Svg width={w} height={height} viewBox="0 0 296 226"
      accessibilityRole="image" accessibilityLabel="온음">
      <Circle cx={68} cy={44} r={33} {...s} />
      <Path d="M 68 107 L 68 129" {...s} />
      <Path d="M 11 167 L 11 215 L 125 215" {...s} />
      <Circle cx={228} cy={44} r={33} {...s} />
      <Rect x={171} y={167} width={114} height={48}
        rx={14} {...s} />
      <Path d="M 11 129 L 285 129" {...s} />
    </Svg>
  )
}
