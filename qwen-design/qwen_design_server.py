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
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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
        print(f"[qwen-design] model unloaded ({reason}) - VRAM released", flush=True)
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
        print(f"[qwen-design] loading model: {MODEL_ID} (bfloat16, sdpa)", flush=True)
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
        print("[qwen-design] model loaded - ready", flush=True)
    except Exception as e:
        _STATE["error"] = f"{type(e).__name__}: {e}"
        print("[qwen-design] model load FAILED:\n" + traceback.format_exc(), flush=True)
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
            })
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
            print("[qwen-design] /design ERROR:\n" + traceback.format_exc(), flush=True)
            self._json(500, {"error": f"{type(e).__name__}: {e}"})


def main():
    global MODEL_ID, IDLE_TIMEOUT
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=9893)
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--idle-timeout", type=int, default=IDLE_TIMEOUT,
                    help="이 초 동안 사용이 없으면 모델을 내려 VRAM 반납(0=해제 안 함)")
    ap.add_argument("--preload", action="store_true",
                    help="시작할 때 모델을 미리 로드(옛 동작). 기본은 지연 로딩.")
    args = ap.parse_args()
    MODEL_ID = args.model
    IDLE_TIMEOUT = max(0, int(args.idle_timeout))

    # 기본 = 지연 로딩(서버만 즉시 뜨고 VRAM 0). --preload 면 옛 동작처럼 미리 올린다.
    if args.preload:
        threading.Thread(target=_load_model, daemon=True).start()
    threading.Thread(target=_idle_watchdog, daemon=True).start()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[qwen-design] server up: http://{args.host}:{args.port} "
          f"(health/prepare/design/release/shutdown) · lazy-load, idle-timeout={IDLE_TIMEOUT}s", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    print("[qwen-design] server stopped", flush=True)


if __name__ == "__main__":
    main()
