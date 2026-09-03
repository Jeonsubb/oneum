/** 목업(UI MOCKUP v3)의 SVG 심볼을 그대로 옮긴 아이콘 세트.
 *  path 데이터는 목업 <symbol>에서 복사했으므로 형태가 동일하다.
 *  목업 원칙 4에 따라 아이콘은 단독으로 쓰지 않고 항상 한글 라벨과 함께 배치한다. */
import Svg, { Path, Circle, Rect } from 'react-native-svg'

export type IconName =
  | 'mic' | 'micoff' | 'vol' | 'voloff' | 'star' | 'check' | 'x' | 'xcirc'
  | 'chev' | 'back' | 'redo' | 'warn' | 'pencil' | 'type' | 'gear' | 'plus' | 'phone'

type P = { name: IconName; size?: number; color?: string }

export function Icon({ name, size = 24, color = 'currentColor' }: P) {
  const common = {
    stroke: color, strokeWidth: 2, fill: 'none',
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'mic' && (<>
        <Path {...common} d="M12 2.5a3.5 3.5 0 0 1 3.5 3.5v6a3.5 3.5 0 0 1-7 0V6A3.5 3.5 0 0 1 12 2.5z" />
        <Path {...common} d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
        <Path {...common} d="M12 18v3.5" /><Path {...common} d="M8.5 21.5h7" />
      </>)}
      {name === 'micoff' && (<>
        <Path {...common} d="M12 2.5a3.5 3.5 0 0 1 3.5 3.5v6" />
        <Path {...common} d="M8.5 8.5V12a3.5 3.5 0 0 0 5.9 2.5" />
        <Path {...common} d="M5.5 11.5a6.5 6.5 0 0 0 10.9 4.8" />
        <Path {...common} d="M18.5 11.5c0 .8-.14 1.5-.4 2.2" />
        <Path {...common} d="M12 18v3.5" /><Path {...common} d="M8.5 21.5h7" />
        <Path {...common} d="M4 4l16 16" />
      </>)}
      {name === 'vol' && (<>
        <Path {...common} d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
        <Path {...common} d="M15.5 9.5a3.8 3.8 0 0 1 0 5" />
        <Path {...common} d="M18 7a7.2 7.2 0 0 1 0 10" />
      </>)}
      {name === 'voloff' && (<>
        <Path {...common} d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
        <Path {...common} d="M16 9.5l5 5" /><Path {...common} d="M21 9.5l-5 5" />
      </>)}
      {name === 'star' && <Path {...common} d="M12 3.2l2.7 5.5 6 .9-4.4 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.3 9.6l6-.9z" />}
      {name === 'check' && <Path {...common} d="M4.5 12.5l5 5 10-11" />}
      {name === 'x' && (<><Path {...common} d="M6 6l12 12" /><Path {...common} d="M18 6L6 18" /></>)}
      {name === 'xcirc' && (<>
        <Circle {...common} cx="12" cy="12" r="9" />
        <Path {...common} d="M9 9l6 6" /><Path {...common} d="M15 9l-6 6" />
      </>)}
      {name === 'chev' && <Path {...common} d="M9 5l7 7-7 7" />}
      {name === 'back' && (<><Path {...common} d="M19 12H5" /><Path {...common} d="M11 6l-6 6 6 6" /></>)}
      {name === 'redo' && (<>
        <Path {...common} d="M20.5 11.5A8.5 8.5 0 1 0 19 16.2" />
        <Path {...common} d="M20.5 5v6.5H14" />
      </>)}
      {name === 'warn' && (<>
        <Path {...common} d="M12 3.5L21.5 20h-19z" />
        <Path {...common} d="M12 9.5v5" /><Path {...common} d="M12 17.6v.5" />
      </>)}
      {name === 'pencil' && <Path {...common} d="M4 20l1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L8 19l-4 1z" />}
      {name === 'type' && (<>
        <Path {...common} d="M5 7V4.5h14V7" /><Path {...common} d="M12 4.5v15" />
        <Path {...common} d="M9 19.5h6" />
      </>)}
      {name === 'gear' && (<>
        <Circle {...common} cx="12" cy="12" r="3.2" />
        <Path {...common} d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
      </>)}
      {name === 'plus' && (<><Path {...common} d="M12 5v14" /><Path {...common} d="M5 12h14" /></>)}
      {name === 'phone' && (<>
        <Rect {...common} x="7.5" y="2.5" width="9" height="19" rx="2.5" />
        <Path {...common} d="M11 18.5h2" />
      </>)}
    </Svg>
  )
}
