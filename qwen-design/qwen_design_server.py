# -*- coding: utf-8 -*-
"""
Qwen3-TTS Voice Design 서버 (Priming-Maker 용)
==============================================
텍스트 설명(instruct)으로 "새 목소리"를 만들어 wav 로 돌려주는 초경량 HTTP 서버.
OmniVoice(9881)·voxcpm(9892) 와 같은 로컬 서버 패턴. 기본 포트 9893.

앱(Electron)이 필요할 때만 이 서버를 띄우고, 끝나면 종료한다(온디맨드).
그래서 평소엔 VRAM 을 전혀 안 먹고, 보이스디자인 하는 잠깐만 1.7B 모델이 GPU 에 올라간다.

엔드포인트
  GET  /health   → {"status":"ok","loaded":bool,"loading":bool,"error":str|null}
  POST /design   본문 JSON {"instruct": "...목소리 설명...", "text": "미리들을 문장",
                            "language": "Korean"} → audio/wav 바이트 반환
  POST /shutdown → 서버 종료(앱이 프로세스를 직접 kill 해도 됨)

설치·실행은 setup_and_run.bat 참조. flash-attn 없이(sdpa) 동작하도록 구성.
"""
import argparse
import io
import json
import os
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ── 로그 ─────────────────────────────────────────────────────────────────────
#  서버가 **스스로** server.log 에 쓴다. 왜: pythonw.exe(콘솔 없는 런처)로 띄우면 stdout 이 무효라
#  print 가 실패할 수 있고, 셸 리다이렉션(`>> server.log`)에 의존하면 cmd 를 거쳐야 해서
#  **검은 콘솔 창이 부팅 때마다 남는다**(실제 발생 2026-08-05). 자체 로깅이면 pythonw 직접 실행이 가능해진다.
_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server.log")


def _log(msg):
    line = "[%s] %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg)
    try:
        with open(_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
    try:  # 콘솔이 있을 때만(수동 실행) 화면에도. pythonw 면 stdout 이 None 이라 조용히 건너뜀.
        if sys.stdout is not None:
            print(line, flush=True)
    except Exception:
        pass

# ── 모델 상태 ────────────────────────────────────────────────────────────────
#  지연 로딩(lazy) + 유휴 자동 해제 정책:
#    · 서버는 모델 없이 즉시 떠서 포트만 열어 둔다(상시 실행해도 VRAM 0).
#    · /prepare 또는 /design 이 오면 그때 모델을 GPU 에 올린다.
#    · 마지막 사용 후 --idle-timeout 초 동안 요청이 없으면 **모델을 내려 VRAM 을 반납**한다.
#  → 다른 PC(아내 PC)가 언제든 쓸 수 있으면서, 안 쓸 때는 GPU 를 점유하지 않는다.
_STATE = {"model": None, "sr": None, "loading": False, "loaded": False, "error": None, "last_used": 0.0}
_LOCK = threading.Lock()       # generate 는 한 번에 하나만(GPU 직렬화)
_LOAD_LOCK = threading.Lock()  # 동시 요청이 모델을 두 번 올리지 않게
IDLE_TIMEOUT = 600             # 초. 0 이면 자동 해제 없음(--idle-timeout 로 변경)

MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"

# ── 목소리 라이브러리 (공용 참조음성 보관소) ──────────────────────────────────
#  왜: 보이스디자인은 이 서버(메인 PC)가 만드는데, 예전엔 결과 wav 가 **만든 사람 PC 에만**
#  저장돼서 나와 아내가 서로의 목소리를 못 썼고, 그 PC 를 초기화하면 사라졌다.
#  → 저장 요청을 서버가 받아 여기에 모아 둔다(누가 만들든 한 곳에 + 백업 겸용).
#  기본값은 실제 운용 경로 D:\TTS_Model\ref-audio, 없으면 이 스크립트 옆 ref-audio.
VOICE_LIB = None  # main() 에서 확정


def _default_voice_lib():
    d = r"D:\TTS_Model\ref-audio"
    if os.path.isdir(d):
        return d
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "ref-audio")


def _safe_name(name):
    """파일명으로 쓸 수 없는 문자 제거 + 경로 탈출 차단(.. 이나 슬래시 금지)."""
    name = str(name or "").strip()
    for ch in '\\/:*?"<>|':
        name = name.replace(ch, "")
    name = name.replace("..", "").strip()
    if name.lower().endswith(".wav"):
        name = name[:-4]
    return name.strip()


def _touch():
    _STATE["last_used"] = time.time()


def _unload_model(reason="idle"):
    """모델을 내려 VRAM 반납. 로드된 상태가 아니면 무동작."""
    with _LOAD_LOCK:
        if not _STATE["loaded"] and _STATE["model"] is None:
            return False
        _STATE["loaded"] = False
        _STATE["model"] = None
        try:
            import gc
            gc.collect()
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except Exception:
            pass
        _log(f"model unloaded ({reason}) - VRAM released")
        return True


def _idle_watchdog():
    """유휴 감시 — IDLE_TIMEOUT 초 동안 사용이 없으면 모델을 내린다."""
    while True:
        time.sleep(20)
        if IDLE_TIMEOUT <= 0 or not _STATE["loaded"] or _STATE["loading"]:
            continue
        idle = time.time() - (_STATE["last_used"] or 0)
        if idle >= IDLE_TIMEOUT:
            _unload_model(f"idle {int(idle)}s")


def _load_model():
    """모델을 GPU 에 올린다(콜드스타트). 이미 로드/로딩 중이면 그대로 둔다."""
    global MODEL_ID
    with _LOAD_LOCK:
        if _STATE["loaded"] or _STATE["loading"]:
            return
        _STATE["loading"] = True
        _STATE["error"] = None
    try:
        import torch
        from qwen_tts import Qwen3TTSModel
        _log(f"loading model: {MODEL_ID} (bfloat16, sdpa)")
        model = Qwen3TTSModel.from_pretrained(
            MODEL_ID,
            device_map="cuda:0",
            dtype=torch.bfloat16,
            # flash-attn 대신 PyTorch 내장 SDPA — 윈도우에서 별도 빌드 불필요.
            attn_implementation="sdpa",
        )
        _STATE["model"] = model
        _STATE["loaded"] = True
        _touch()
        _log("model loaded - ready")
    except Exception as e:
        _STATE["error"] = f"{type(e).__name__}: {e}"
        _log("model load FAILED:\n" + traceback.format_exc())
    finally:
        _STATE["loading"] = False


def _synth(instruct: str, text: str, language: str):
    """보이스디자인 1회. wav(np.ndarray), sr(int) 반환."""
    model = _STATE["model"]
    if model is None:
        raise RuntimeError("모델 미로딩")
    with _LOCK:
        wavs, sr = model.generate_voice_design(
            text=text,
            language=language or "Korean",
            instruct=instruct,
        )
    wav = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
    return wav, sr


def _wav_bytes(wav, sr) -> bytes:
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, wav, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    # 콘솔 스팸 억제
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            idle = (time.time() - _STATE["last_used"]) if _STATE["last_used"] else None
            self._json(200, {
                "status": "ok",
                "loaded": bool(_STATE["loaded"]),
                "loading": bool(_STATE["loading"]),
                "error": _STATE["error"],
                # 지연 로딩 서버임을 클라이언트가 알 수 있게(구버전 앱은 무시함)
                "lazy": True,
                "idleTimeout": IDLE_TIMEOUT,
                "idleSec": int(idle) if idle is not None else None,
                # 공용 목소리 라이브러리 지원 여부(구버전 앱은 무시함)
                "voiceLib": VOICE_LIB,
            })
        # 공용 목소리 목록 — 누가 만들었든 이 서버에 모인 참조음성 전부.
        elif self.path.rstrip("/") == "/voices":
            items = []
            try:
                for fn in sorted(os.listdir(VOICE_LIB)):
                    if not fn.lower().endswith(".wav"):
                        continue
                    stem = fn[:-4]
                    txt = ""
                    tp = os.path.join(VOICE_LIB, stem + ".txt")
                    if os.path.isfile(tp):
                        try:
                            with open(tp, encoding="utf-8") as f:
                                txt = f.read().strip()
                        except Exception:
                            pass
                    p = os.path.join(VOICE_LIB, fn)
                    items.append({"name": stem, "text": txt, "bytes": os.path.getsize(p)})
            except Exception as e:
                self._json(500, {"error": "%s: %s" % (type(e).__name__, e)})
                return
            self._json(200, {"dir": VOICE_LIB, "voices": items})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.rstrip("/")
        if path == "/shutdown":
            self._json(200, {"status": "bye"})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        # 모델 로드 요청(비동기) — 창을 열 때 앱이 먼저 호출한다. 이미 로드/로딩 중이면 무해.
        if path == "/prepare":
            _touch()
            if not _STATE["loaded"] and not _STATE["loading"]:
                threading.Thread(target=_load_model, daemon=True).start()
            self._json(200, {"status": "preparing", "loaded": bool(_STATE["loaded"]), "loading": bool(_STATE["loading"])})
            return
        # 모델만 내려 VRAM 반납(서버는 계속 살아 있음) — 앱이 창을 닫을 때 호출.
        if path == "/release":
            released = _unload_model("release")
            self._json(200, {"status": "released", "released": bool(released)})
            return
        # 공용 라이브러리에 목소리 등록 — 앱이 자기 PC 에 저장한 뒤 같은 것을 여기로도 보낸다.
        #   body {name, text, instruct, wav_b64}. 같은 이름이 있으면 _2, _3… 으로 피한다(덮어쓰지 않음).
        if path == "/save-voice":
            try:
                length = int(self.headers.get("Content-Length") or 0)
                req = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                name = _safe_name(req.get("name"))
                if not name:
                    self._json(400, {"error": "name 이 비어 있습니다"})
                    return
                b64 = req.get("wav_b64") or ""
                if not b64:
                    self._json(400, {"error": "wav_b64 가 비어 있습니다"})
                    return
                import base64
                data = base64.b64decode(b64)
                if len(data) < 44 or data[:4] != b"RIFF":
                    self._json(400, {"error": "wav 데이터가 아닙니다"})
                    return
                os.makedirs(VOICE_LIB, exist_ok=True)
                base, i = name, 2
                while os.path.exists(os.path.join(VOICE_LIB, base + ".wav")):
                    base = "%s_%d" % (name, i)
                    i += 1
                wav_path = os.path.join(VOICE_LIB, base + ".wav")
                with open(wav_path, "wb") as f:
                    f.write(data)
                # 같은 이름 .txt = 참조텍스트(OmniVoice Voice Clone 이 필요로 한다)
                with open(os.path.join(VOICE_LIB, base + ".txt"), "w", encoding="utf-8") as f:
                    f.write(str(req.get("text") or "").strip())
                inst = str(req.get("instruct") or "").strip()
                if inst:  # 어떤 설명으로 만든 목소리인지 남겨 둔다(나중에 재현·수정용)
                    with open(os.path.join(VOICE_LIB, base + ".instruct.txt"), "w", encoding="utf-8") as f:
                        f.write(inst)
                _log("voice saved: %s.wav (%d bytes) -> %s" % (base, len(data), VOICE_LIB))
                self._json(200, {"ok": True, "name": base, "path": wav_path})
            except Exception:
                _log("/save-voice ERROR:\n" + traceback.format_exc())
                self._json(500, {"error": "save 실패"})
            return
        if path != "/design":
            self._json(404, {"error": "not found"})
            return
        # 지연 로딩: 아직 안 올라와 있으면 여기서 로드하고 기다린다(/prepare 를 안 거쳐도 동작).
        _touch()
        if not _STATE["loaded"]:
            if not _STATE["loading"]:
                threading.Thread(target=_load_model, daemon=True).start()
            t0 = time.time()
            while (not _STATE["loaded"]) and (time.time() - t0 < 1200):  # 최대 20분(첫 다운로드 포함)
                if _STATE["error"]:
                    break
                time.sleep(1.0)
        if not _STATE["loaded"]:
            self._json(503, {"error": "모델 로딩 중 또는 실패", "loading": _STATE["loading"], "detail": _STATE["error"]})
            return
        try:
            ln = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(ln).decode("utf-8")) if ln else {}
            instruct = (req.get("instruct") or "").strip()
            text = (req.get("text") or "").strip()
            language = (req.get("language") or "Korean").strip()
            if not instruct:
                self._json(400, {"error": "instruct(목소리 설명)가 비어 있음"})
                return
            if not text:
                text = "안녕하세요. 이 목소리로 이야기를 들려드리겠습니다."
            wav, sr = _synth(instruct, text, language)
            _touch()  # 생성 직후 갱신 — 긴 생성 도중 유휴 판정으로 내려가지 않게
            data = _wav_bytes(wav, sr)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            _log("/design ERROR:\n" + traceback.format_exc())
            self._json(500, {"error": f"{type(e).__name__}: {e}"})


def main():
    global MODEL_ID, IDLE_TIMEOUT, VOICE_LIB
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=9893)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--idle-timeout", type=int, default=IDLE_TIMEOUT,
                    help="이 초 동안 사용이 없으면 모델을 내려 VRAM 반납(0=해제 안 함)")
    ap.add_argument("--preload", action="store_true",
                    help="시작할 때 모델을 미리 로드(옛 동작). 기본은 지연 로딩.")
    ap.add_argument("--voice-lib", default=None,
                    help="공용 목소리 라이브러리 폴더(기본 D:\\TTS_Model\\ref-audio)")
    args = ap.parse_args()
    MODEL_ID = args.model
    IDLE_TIMEOUT = max(0, int(args.idle_timeout))
    VOICE_LIB = args.voice_lib or _default_voice_lib()
    try:
        os.makedirs(VOICE_LIB, exist_ok=True)
    except Exception:
        pass

    # 기본 = 지연 로딩(서버만 즉시 뜨고 VRAM 0). --preload 면 옛 동작처럼 미리 올린다.
    if args.preload:
        threading.Thread(target=_load_model, daemon=True).start()
    threading.Thread(target=_idle_watchdog, daemon=True).start()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    _log(f"server up: http://{args.host}:{args.port} "
         f"(health/voices/prepare/design/save-voice/release/shutdown) · "
         f"lazy-load, idle-timeout={IDLE_TIMEOUT}s, voice-lib={VOICE_LIB}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    _log("server stopped")


if __name__ == "__main__":
    main()
