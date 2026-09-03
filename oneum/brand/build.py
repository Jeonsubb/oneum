#!/usr/bin/env python3
"""온음 브랜드 자산 생성기 — `python3 build.py` (rsvg-convert 필요: brew install librsvg)

로고는 심볼이 아니라 **글자(워드마크)**이고, 폰트로 조판한 것이 아니라 직접 그린 도형이다.
그래서 폰트가 없는 PC에서도, 제출용 문서에서도 모양이 그대로 유지된다.

부드러움을 만드는 장치는 세 가지다.
  · 모든 획 끝과 꺾임을 둥글린다 (stroke-linecap / linejoin = round)
  · ㅇ의 속공간을 넓게 연다 (획이 두꺼우면 속이 막혀 답답해진다)
  · ㅁ의 모서리 반경을 14로 고정한다 (높이에 비례시키면 타원이 되어 ㅁ으로 안 읽힌다)

치수는 전부 '잉크 기준'이다. round cap 탓에 획 중심선과 실제 잉크 경계가 w/2 어긋나므로,
중심선으로 정의하면 굵기를 바꿀 때마다 비례가 어그러진다.
"""
import re
import subprocess
from pathlib import Path

BRAND = "#14508C"   # mobile/lib/theme.ts 의 palette('blue').acc 와 같은 값이어야 한다
INK = "#191B1E"
WHITE = "#FFFFFF"

# 확정 비례. 굵기만 20~24 사이에서 조정 가능하며, 그 밖의 값은 함께 손봐야 한다.
W = 22          # 획 두께
CIRC_D = 88     # ㅇ 바깥 지름
SYL_W = 136     # 음절 하나의 가로 폭
BOT_H = 70      # 아래 자소(ㄴ·ㅁ) 높이. 낮추면 ㅁ이 납작한 알약처럼 보인다
TICK = 22       # ㅗ 세로획 중 가로획 위로 드러나는 길이
GAP = 24        # 두 음절 사이
CORNER = 14     # ㅁ 모서리 반경 (고정)

ROOT = Path(__file__).parent
ASSETS = ROOT.parent / "mobile" / "assets"


def wordmark(color: str = BRAND, w: float = W, join: bool = True, pad_ratio: float = 0.10) -> str:
    """온음 워드마크. join=True면 온의 ㅗ 가로획과 음의 ㅡ가 한 줄로 이어진다."""
    h = w / 2
    cy = CIRC_D / 2                       # ㅇ 잉크 윗변이 y=0에 오도록
    ring_r = CIRC_D / 2 - h               # 원 획 중심선 반지름
    tick_top = CIRC_D + 8 + h             # ㅇ 아래로 8만큼 띄우고 시작
    bar_y = tick_top + TICK
    bot_t = bar_y + h + 16 + h            # 가로획 아래로 16만큼 띄운다
    bot_b = bot_t + BOT_H - w

    left = h                              # 왼쪽 잉크가 x=0
    nieun_r = left + SYL_W - w
    mieum_l = left + SYL_W + GAP
    right = mieum_l + SYL_W - w
    on_cx = left + (SYL_W - w) / 2
    eum_cx = mieum_l + (SYL_W - w) / 2

    s = (f'stroke="{color}" stroke-width="{w}" fill="none" '
         'stroke-linecap="round" stroke-linejoin="round"')
    parts = [
        f'<circle cx="{on_cx}" cy="{cy}" r="{ring_r}" {s}/>',                      # 온 ㅇ
        f'<path d="M {on_cx} {tick_top} L {on_cx} {bar_y}" {s}/>',                 # 온 ㅗ 세로
        f'<path d="M {left} {bot_t} L {left} {bot_b} L {nieun_r} {bot_b}" {s}/>',  # 온 ㄴ
        f'<circle cx="{eum_cx}" cy="{cy}" r="{ring_r}" {s}/>',                     # 음 ㅇ
        f'<rect x="{mieum_l}" y="{bot_t}" width="{right - mieum_l}" height="{bot_b - bot_t}" '
        f'rx="{min(CORNER, (bot_b - bot_t) / 2)}" {s}/>',                          # 음 ㅁ
    ]
    if join:
        parts.append(f'<path d="M {left} {bar_y} L {right} {bar_y}" {s}/>')
    else:
        parts.append(f'<path d="M {left} {bar_y} L {nieun_r} {bar_y}" {s}/>')
        parts.append(f'<path d="M {mieum_l} {bar_y} L {right} {bar_y}" {s}/>')

    vw, vh = right + h, bot_b + h
    pad = vh * pad_ratio
    return (f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="{-pad:.1f} {-pad:.1f} {vw + pad * 2:.1f} {vh + pad * 2:.1f}" '
            f'width="{vw + pad * 2:.0f}" height="{vh + pad * 2:.0f}">{"".join(parts)}</svg>')


def rn_component() -> str:
    """앱에서 쓸 react-native-svg 컴포넌트를 워드마크와 같은 수치로 생성한다.

    앱에 좌표를 손으로 옮겨 적으면 build.py의 상수를 고쳤을 때 로고가 둘로 갈라진다.
    그래서 컴포넌트도 여기서 함께 뽑는다 — 브랜드 자산과 앱 로고는 항상 같은 도형이다.
    """
    h = W / 2
    cy = CIRC_D / 2
    ring_r = CIRC_D / 2 - h
    tick_top = CIRC_D + 8 + h
    bar_y = tick_top + TICK
    bot_t = bar_y + h + 16 + h
    bot_b = bot_t + BOT_H - W
    left = h
    nieun_r = left + SYL_W - W
    mieum_l = left + SYL_W + GAP
    right = mieum_l + SYL_W - W
    on_cx = left + (SYL_W - W) / 2
    eum_cx = mieum_l + (SYL_W - W) / 2
    vw, vh = right + h, bot_b + h
    corner = min(CORNER, (bot_b - bot_t) / 2)
    return f"""/** 온음 워드마크 — brand/build.py 가 생성한다. 직접 고치지 말 것.
 *  형태를 바꾸려면 brand/build.py 의 상수를 고치고 `python3 build.py` 를 다시 돌린다.
 */
import Svg, {{ Circle, Path, Rect }} from 'react-native-svg'

export function Wordmark({{ height = 30, color = '{BRAND}' }}: {{ height?: number; color?: string }}) {{
  const w = height * {vw / vh:.4f}
  const s = {{
    stroke: color, strokeWidth: {W}, fill: 'none',
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }}
  return (
    <Svg width={{w}} height={{height}} viewBox="0 0 {vw:.0f} {vh:.0f}"
      accessibilityRole="image" accessibilityLabel="온음">
      <Circle cx={{{on_cx:.0f}}} cy={{{cy:.0f}}} r={{{ring_r:.0f}}} {{...s}} />
      <Path d="M {on_cx:.0f} {tick_top:.0f} L {on_cx:.0f} {bar_y:.0f}" {{...s}} />
      <Path d="M {left:.0f} {bot_t:.0f} L {left:.0f} {bot_b:.0f} L {nieun_r:.0f} {bot_b:.0f}" {{...s}} />
      <Circle cx={{{eum_cx:.0f}}} cy={{{cy:.0f}}} r={{{ring_r:.0f}}} {{...s}} />
      <Rect x={{{mieum_l:.0f}}} y={{{bot_t:.0f}}} width={{{right - mieum_l:.0f}}} height={{{bot_b - bot_t:.0f}}}
        rx={{{corner:.0f}}} {{...s}} />
      <Path d="M {left:.0f} {bar_y:.0f} L {right:.0f} {bar_y:.0f}" {{...s}} />
    </Svg>
  )
}}
"""


def square(src: str, size: int, ratio: float, bg: str | None, fg: str) -> str:
    """워드마크를 정사각 캔버스 가운데 앉힌다. ratio는 캔버스 대비 로고의 긴 변 비율."""
    vb = re.search(r'viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"', src)
    vx, vy, vw, vh = (float(g) for g in vb.groups())
    inner = src.split(">", 1)[1].rsplit("</svg>", 1)[0].replace(BRAND, fg)
    scale = size * ratio / max(vw, vh)
    ox = (size - vw * scale) / 2 - vx * scale
    oy = (size - vh * scale) / 2 - vy * scale
    back = f'<rect width="{size}" height="{size}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
            f'viewBox="0 0 {size} {size}">{back}'
            f'<g transform="translate({ox:.2f},{oy:.2f}) scale({scale:.5f})">{inner}</g></svg>')


def render(svg: str, out: Path, width: int, height: int | None = None) -> None:
    # 높이를 생략하면 rsvg가 폭과 같은 값을 써서 정사각 여백이 붙는다. viewBox 비율로 계산한다.
    if height is None:
        vb = re.search(r'viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"', svg)
        height = round(width * float(vb.group(2)) / float(vb.group(1))) if vb else width
    tmp = ROOT / "_tmp.svg"
    tmp.write_text(svg, encoding="utf-8")
    subprocess.run(["rsvg-convert", "-w", str(width), "-h", str(height),
                    str(tmp), "-o", str(out)], check=True)
    tmp.unlink()


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    png = ROOT / "png"
    png.mkdir(exist_ok=True)

    brand = wordmark(BRAND)
    (ROOT / "oneum-wordmark.svg").write_text(brand, encoding="utf-8")
    (ROOT / "oneum-wordmark-white.svg").write_text(wordmark(WHITE), encoding="utf-8")
    (ROOT / "oneum-wordmark-mono.svg").write_text(wordmark(INK), encoding="utf-8")

    # ── 앱 아이콘 ──
    # 홈 화면에서 흰 배경 아이콘은 밝은 배경화면에 묻히므로 파랑 채움 + 흰 글자로 간다.
    render(square(brand, 1024, 0.74, BRAND, WHITE), ASSETS / "icon.png", 1024)
    render(square(brand, 96, 0.86, BRAND, WHITE), ASSETS / "favicon.png", 48)
    # 스플래시는 앱 본문과 같은 흰 배경이므로 파랑 글자를 그대로 쓴다.
    render(square(brand, 1024, 0.70, None, BRAND), ASSETS / "splash-icon.png", 1024)
    # 안드로이드 적응형 아이콘은 원형 마스크에 잘린다. 로고가 지름 66% 안전원 안에
    # 완전히 들어가려면 대각선이 그 원을 넘지 않아야 하므로 0.53까지만 키운다.
    render(square(brand, 512, 0.53, None, WHITE), ASSETS / "android-icon-foreground.png", 512)
    render(f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">'
           f'<rect width="512" height="512" fill="{BRAND}"/></svg>',
           ASSETS / "android-icon-background.png", 512)
    render(square(brand, 432, 0.53, None, WHITE), ASSETS / "android-icon-monochrome.png", 432)

    # ── 앱에서 쓸 컴포넌트 (좌표를 손으로 옮기면 로고가 둘로 갈라진다) ──
    (ROOT.parent / "mobile" / "components" / "Wordmark.tsx").write_text(
        rn_component(), encoding="utf-8")

    # ── 문서용 PNG (한글 폰트가 없는 PC의 docx·발표자료용) ──
    render(brand, png / "wordmark-1200.png", 1200)
    render(wordmark(WHITE), png / "wordmark-white-1200.png", 1200)

    print("생성 완료:", ROOT)


if __name__ == "__main__":
    main()
