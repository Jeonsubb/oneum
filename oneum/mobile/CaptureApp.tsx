/** 화면 캡처 전용 엔트리 (웹) — 제출물(별지·포스터)에 넣을 화면을 실제 컴포넌트로 렌더한다.
 *
 *  사용법: `npx expo export --platform web` 후 정적 서버에서 `/?shot=home` 처럼 연다.
 *  각 shot은 고정 props의 목업 데이터로 화면 하나를 그대로 그린다. 백엔드·마이크가 필요 없다.
 *  이 파일은 제품 동작에 관여하지 않는다 — index.ts가 웹 + ?shot= 조건에서만 불러온다.
 */
import './lib/font'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { View, Text } from 'react-native'
import { TABBAR_CONTENT_HEIGHT, TabBar, layout } from './components/ui'
import {
  ConfirmChoiceScreen, ConfirmSureScreen, DeliverScreen, FailScreen, HomeScreen,
} from './screens/Core'
import { EditScreen, OnboardScreen } from './screens/Support'
import {
  AiChatScreen, ChatHomeScreen, ConsentScreen, PracticeHomeScreen, PracticeResultScreen,
  PracticeRunScreen, QuickPreviewScreen, type ChatScenario, type PracticeSet,
} from './screens/Practice'

const noop = () => {}

const PRESETS = [
  { text: '접수하러 왔어요', situation: '병원' as const },
  { text: '진료 예약을 바꾸고 싶어요', situation: '병원' as const },
  { text: '많이 아파요', situation: '병원' as const },
  { text: '이거 주세요', situation: '매장' as const },
  { text: '물 한 잔 주세요', situation: '일상' as const },
  { text: '천천히 말씀해 주세요', situation: '일상' as const },
]

const SETS: PracticeSet[] = [
  { name: '병원에서', kind: 'situation', situation: '병원', sentences: [], total: 4, verified: 3, draft: true },
  { name: '매장에서', kind: 'situation', situation: '매장', sentences: [], total: 3, verified: 1, draft: true },
  { name: '일상 인사', kind: 'situation', situation: '일상', sentences: [], total: 3, verified: 2, draft: true },
  { name: '공공기관에서', kind: 'situation', situation: '공공기관', sentences: [], total: 2, verified: 0, draft: true },
]

const SCENARIOS: ChatScenario[] = [
  { name: '병원 접수처', situation: '병원', scenario: '' },
  { name: '카페에서 주문', situation: '매장', scenario: '' },
  { name: '주민센터 민원', situation: '공공기관', scenario: '' },
]

const CHAT_MSGS: { role: 'user' | 'ai'; text: string }[] = [
  { role: 'ai', text: '안녕하세요. 오늘 어떤 진료 때문에 오셨나요?' },
  { role: 'user', text: '어제부터 허리가 아파서 왔어요' },
  { role: 'ai', text: '많이 불편하셨겠어요. 성함이 어떻게 되세요?' },
  { role: 'user', text: '전동훈입니다' },
  { role: 'ai', text: '네, 접수됐습니다. 잠시만 기다려 주세요.' },
]

function shotContent(shot: string): { node: React.ReactNode; tab?: 'home' | 'practice' | 'chat' } {
  switch (shot) {
    case 'home':
      return {
        tab: 'home',
        node: <HomeScreen situation="병원" onSituation={noop} onMicDown={noop}
          notice="인식을 위해 음성이 Microsoft Azure로 암호화되어 전송됩니다. 등록 문장과 기록은 이 휴대폰에만 저장됩니다" />,
      }
    case 'confirmSure':
      return { node: <ConfirmSureScreen text="접수하러 왔어요" onConfirm={noop} onSeeOthers={noop} /> }
    case 'confirmChoice':
      return {
        node: <ConfirmChoiceScreen
          candidates={[
            { text: '접수하러 왔어요' },
            { text: '진료 예약을 바꾸고 싶어요' },
            { text: '접수 좀 도와주세요', suggested: true },
          ]}
          onPick={noop} onEdit={noop} onNone={noop} />,
      }
    case 'deliver':
      return {
        node: <DeliverScreen text={'접수하러\n왔어요'} device="이 휴대폰" onSpeak={noop} onBack={noop} onNext={noop} />,
      }
    case 'fail':
      return { node: <FailScreen retries={1} onRetry={noop} onType={noop} /> }
    case 'edit':
      return { node: <EditScreen initial="접수하러 왔어요" onConfirm={noop} onBack={noop} /> }
    case 'onboard':
      return {
        node: <OnboardScreen presets={PRESETS} picked={new Set(['접수하러 왔어요', '물 한 잔 주세요'])}
          registered={[{ id: '1', text: '카드로 결제할게요', situation: '매장' }]}
          onToggle={noop} onAddCustom={noop} onRemove={noop} onDone={noop} onBack={noop} />,
      }
    case 'practiceHome':
      return {
        tab: 'practice',
        node: <PracticeHomeScreen sets={SETS} onStart={noop} onHistory={noop} onManage={noop} />,
      }
    case 'practiceRun':
      return {
        node: <PracticeRunScreen sentence="접수하러 왔어요" index={0} total={4} round={3}
          onRecord={noop} onSkip={noop} onBack={noop} />,
      }
    case 'practiceResult':
      return {
        node: <PracticeResultScreen sentence="접수하러 왔어요"
          heard={['접수하러 왔어요', '접수하러 왔어요', '접수하러 와써요']}
          matched={[true, true, true]} passed onRegister={noop} onRetry={noop} onNext={noop} />,
      }
    case 'consent':
      return {
        node: <ConsentScreen value={{ verify: true, adapt: false, research: false }}
          onToggle={noop} onDone={noop} onBack={noop} />,
      }
    case 'chatHome':
      return { tab: 'chat', node: <ChatHomeScreen scenarios={SCENARIOS} onStartChat={noop} /> }
    case 'aiChat':
      return {
        node: <AiChatScreen title="병원 접수처" messages={CHAT_MSGS} recording={false} busy={false}
          onRecord={noop} onReplay={noop} onBack={noop} />,
      }
    case 'quickPreview':
      return { node: <QuickPreviewScreen text={'물 한 잔\n주세요'} onFire={noop} onCancel={noop} /> }
    default:
      return { node: <Text>?shot= 파라미터를 지정하세요</Text> }
  }
}

// 웹에서 온고딕을 CSS로 등록한다. 같은 family 이름에 weight별 face를 두면
// react-native-web이 내보내는 font-weight에 맞춰 브라우저가 알맞은 face를 고른다.
// 폰트 파일은 export 후 dist/fonts/ 에 복사해 둔다 (스크립트에서 처리).
if (typeof document !== 'undefined') {
  const css = ['Regular:400', 'Bold:700', 'ExtraBold:800'].map(pair => {
    const [face, weight] = pair.split(':')
    return `@font-face { font-family: 'KoddiUD'; font-weight: ${weight};
      src: url('/fonts/KoddiUDOnGothic-${face}.ttf') format('truetype'); }`
  }).join('\n') + `\n#root, #root * { font-family: 'KoddiUD', sans-serif !important; }`
  const tag = document.createElement('style')
  tag.textContent = css
  document.head.appendChild(tag)
}

export default function CaptureApp() {
  const shot = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('shot') ?? 'home'
    : 'home'
  const { node, tab } = shotContent(shot)
  return (
    <SafeAreaProvider>
      <SafeAreaView style={layout.screen} edges={['top', 'left', 'right']}>
        <View style={{ flex: 1, paddingBottom: tab ? TABBAR_CONTENT_HEIGHT : 0 }}>{node}</View>
        {tab && <TabBar active={tab} onSelect={noop} />}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}
