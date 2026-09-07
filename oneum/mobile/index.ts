import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

// 웹에서 ?shot= 파라미터가 있으면 제출물용 화면 갤러리(CaptureApp)를 렌더한다.
// 네이티브 앱 동작에는 관여하지 않는다.
const isCapture =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  window.location.search.includes('shot=');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Root = isCapture ? require('./CaptureApp').default : require('./App').default;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Root);
