/** 제출물용 화면 캡처 — dist(웹 export)를 로컬 서버로 띄운 상태에서 실행한다.
 *  사용법: node scripts/capture-screens.js <출력디렉토리> [서버주소]
 */
const puppeteer = require('puppeteer-core')

const SHOTS = [
  'home', 'confirmSure', 'confirmChoice', 'deliver', 'fail', 'edit', 'onboard',
  'practiceHome', 'practiceRun', 'practiceResult', 'consent', 'chatHome', 'aiChat', 'quickPreview',
]

const outDir = process.argv[2] || '.'
const base = process.argv[3] || 'http://localhost:8877'

;(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
  })
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)))
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  for (const shot of SHOTS) {
    await page.goto(`${base}/?shot=${shot}`, { waitUntil: 'networkidle0', timeout: 30000 })
    await page.evaluate(() => document.fonts.ready)   // 온고딕 로드 완료까지 대기
    await new Promise(r => setTimeout(r, 700))         // 애니메이션·레이아웃 안정화
    await page.screenshot({ path: `${outDir}/${shot}.png` })
    console.log('shot:', shot)
  }
  await browser.close()
})()
