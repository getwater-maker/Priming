import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 렌더러(React)만 빌드. Electron main/preload 은 별도(소스 그대로 실행).
//   dev:  vite dev server (HMR) → main.js 가 PM_DEV_URL 로드
//   prod: renderer/dist/index.html 정적 파일 → main.js 가 loadFile
export default defineConfig({
  root: 'renderer',
  base: './',                       // file:// 로딩을 위해 상대경로 자산
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // core/ 는 Electron main 과 공유하는 CommonJS 다. 렌더러도 같은 파일을 쓰므로
    //   (자막 분할 정본 = core/caption-splitter.js) rollup 의 commonjs 변환 대상에 넣는다.
    //   ⚠ include 를 쓰면 기본값 [/node_modules/] 를 덮어쓴다 → 함께 나열할 것.
    commonjsOptions: { include: [/node_modules/, /[\\/]core[\\/]/], transformMixedEsModules: true },
  },
  // fs.allow: root(renderer) 밖의 core/ 를 dev 서버에서도 읽게 한다 —
  //   renderer/src/lib/captions.js 가 core/caption-splitter.js(자막 분할 정본)를 직접 import 한다.
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
});
