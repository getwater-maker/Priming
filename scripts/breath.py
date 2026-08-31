"""참조음성(TTS 음성복제용 wav)에서 숨소리를 찾아 없앤다. (2026-08-17)

왜 필요한가 — zero-shot 클론은 **참조음성의 버릇을 그대로 복제한다.** 참조에 숨소리가
  있으면 TTS 결과마다 숨이 따라 나온다(v0.3.3 의 '문장 끝 감쇠가 옮는' 문제와 같은 계열).

━━ 실행 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  numpy 가 필요하므로 OmniVoice 환경의 파이썬으로 돌린다(`-s` 로 사용자 site-packages 차단):

    D:\\TTS_Model\\omnivoice\\env\\python.exe -s scripts\\breath.py <wav>
    D:\\TTS_Model\\omnivoice\\env\\python.exe -s scripts\\breath.py <wav> --preview --apply

  · 인자 없이  = 탐지만 하고 보고(원본 무수정) ← **항상 이걸 먼저 본다**
  · --preview  = 지울 소리만 모은 <이름>_breathsOnly.wav 생성 → **귀로 확인용**
  · --apply    = <이름>_noBreath.wav 생성 (원본은 절대 건드리지 않는다)

  ⚠ 참조음성 라이브러리(D:\\TTS_Model\\ref-audio)에 바로 만들면 _breathsOnly 까지
    앱 드롭다운에 목소리로 뜬다. 확인용 파일은 만든 뒤 라이브러리 밖으로 옮길 것.
  ⚠ <이름>_noBreath.txt (참조텍스트)를 원본 .txt 에서 복사해 짝을 맞춰야 한다.
    짝이 없으면 서버가 참조텍스트 없이 합성해 **엉뚱한 목소리가 조용히 나간다**(v0.3.8).

━━ 설계 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
탐지 — 마찰음(ㅅ·ㅎ·ㅊ)과 숨은 둘 다 잡음성이라 스펙트럼만으론 못 가른다.
  가르는 기준은 **위치**다: 마찰음은 낱말 안에, 숨은 '말이 쉬는 구간' 안에 있다.
  ① 먼저 쉼을 찾고 ② 그 안에서만 소리가 남은 곳을 숨 후보로 본다.

제거 — 잘라내지 않고 **제자리에서 눕힌다.** 잘라내면 길이가 바뀌어 참조텍스트와의
  대응이 흔들린다. 눕히면 '쉴 때는 조용하다'를 클론이 배우므로 목적에 그대로 맞는다.
  int16 원본을 그대로 들고 가므로 **숨 구간 밖은 비트 단위로 동일**하다.

━━ 실측으로 얻은 함정 3개 (전부 한 번씩 밟았다) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. **쉼 판정이 느슨하면 마찰음이 숨으로 둔갑한다.** `--min-pause-ms` 를 120 으로 뒀더니
   「좋아합니다」의 「ㅎ」 주변 음량 저하가 쉼으로 잡혀 그 마찰음을 지웠고, 발음이
   뭉개져 들렸다. 실측 = 오탐은 120ms 쉼 안 / 진짜 숨은 335ms+ 쉼 안 → 기본값 250.
2. **숨은 잡음이 아니라 다음 낱말로 들어가는 진입 경사다.** 완전 무음으로 지웠더니
   바로 뒤 낱말이 뚝 시작해 잘린 것처럼 들렸다 → `--lead-ms`(기본 120)로 말 쪽 경사를
   길게 둔다. 반대쪽(`--fade-ms`)도 여운이 긴 녹음에선 60 정도로 올릴 것.
3. **평탄도보다 고역비율이 잘 가른다.** 저역이 강한 녹음에선 평탄도가 눌려 변별력이
   없다. 실측 = 숨 0.34~0.79 / 룸톤·웅웅거림 0.00~0.21 → `--min-hf` 0.25 로 갈린다.

🔑 **소리 판정은 사람이 한다.** 계측은 "바뀐 샘플이 전부 쉼 안"까지만 보증하고,
   그 쉼이 진짜 쉼인지는 못 본다. 위 1번도 로이가 원본과 대조해 청취로 잡아냈다.
   반드시 --preview 로 지울 소리를 들어보고, 처리 후 원본과 A/B 할 것.

🔑 **--lead-ms 가 결정적이다**(2026-08-31 실측). 기본 60ms 는 숨의 꼬리를 경사 구간에 남긴다 —
   #01_득수 를 기본값으로 처리해도 4.7초 지점에 **-34.5dB 짜리 숨이 그대로 남았고**, 반복 적용해도
   -43dB 에서 수렴해 버렸다. `--lead-ms 20` 으로 낮추니 **-63.3dB**(25.8dB 개선). 낱말이 뚝 시작하는
   부작용은 20ms 면 들리지 않았다. **숨이 남으면 반복하지 말고 lead-ms 를 먼저 줄일 것.**

🔑 **쉼이 통째로 있는 녹음은 「덩어리만 잘라 재조립」이 더 낫다**(2026-08-31). 001 테이크는 숨이 12개라
   못 쓸 줄 알았는데, **그 숨이 전부 쉼 구간에 있었다.** 발화 덩어리 4개만 잘라내고 쉼을 무음 350ms 로
   새로 넣으니 숨이 통째로 사라지면서 **억양은 그대로 남았다**(폭 67Hz · 결과물 문장앞숨 0/8).
   경계엔 15ms 페이드를 주고 덩어리 간 음량 편차만 ±3dB 안에서 맞춘다.

📌 숨 제거보다 **어느 녹음을 쓰느냐가 더 크게 작용한다**(실측). 같은 화자라도 숨이
   말보다 19~37dB 아래인 녹음은 지워도 결과에 숨이 남고(-45~-56dB), 37~44dB 아래인
   녹음은 결과에서도 사실상 안 들린다(-65~-87dB). **조용히 녹음된 것을 고를 것.**
"""
import argparse
import os
import sys
import wave

import numpy as np

FRAME_MS = 20.0
HOP_MS = 5.0


def read_wav(path):
    """분석용 float 과 **원본 int16** 을 함께 돌려준다.

    🔑 출력은 int16 원본을 그대로 들고 가서 숨 구간만 손댄다.
       float 로 변환했다가 되돌리면 배율 차이(32768 vs 32767)로 **전 샘플이 재양자화**되어
       "말소리는 안 건드렸다"를 증명할 수 없게 된다.
    """
    with wave.open(path, "rb") as w:
        n, ch, sw, sr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(n)
    if sw != 2:
        raise SystemExit(f"16bit PCM 만 지원합니다 (현재 {sw * 8}bit)")
    pcm = np.frombuffer(raw, dtype="<i2")
    if ch > 1:
        pcm = pcm.reshape(-1, ch).mean(axis=1).round().astype("<i2")
    a = pcm.astype(np.float32) / 32768.0
    return a, pcm, sr, ch, sw


def write_wav(path, pcm, sr):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(np.asarray(pcm, dtype="<i2").tobytes())


def envelope(a, sr):
    win = max(1, int(sr * FRAME_MS / 1000))
    hop = max(1, int(sr * HOP_MS / 1000))
    if len(a) < win:
        return np.array([]), hop, win
    n = 1 + (len(a) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    frames = a[idx]
    rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms + 1e-12), hop, win


def features(a, sr):
    """프레임별 (평탄도, 고역비율, 영교차율).

    🔑 숨과 말끝을 가르는 핵심은 **스펙트럼 평탄도**다.
       숨 = 잡음 → 스펙트럼이 평평하다(1에 가깝다).
       유성음(말끝·모음) = 배음 구조 → 뾰족하다(0에 가깝다).
       레벨만 보면 둘이 겹치지만 이 값은 확실히 갈린다.
    """
    win = max(1, int(sr * FRAME_MS / 1000))
    hop = max(1, int(sr * HOP_MS / 1000))
    n = 1 + (len(a) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    fr = a[idx] * np.hanning(win)[None, :]

    spec = np.abs(np.fft.rfft(fr, axis=1)) ** 2 + 1e-12
    gm = np.exp(np.mean(np.log(spec), axis=1))
    am = np.mean(spec, axis=1)
    flat = gm / am

    freqs = np.fft.rfftfreq(win, 1.0 / sr)
    hf = spec[:, freqs > 1500].sum(axis=1) / spec.sum(axis=1)

    raw = a[idx]
    zcr = np.mean(np.abs(np.diff(np.sign(raw), axis=1)) > 0, axis=1)
    return flat, hf, zcr


def merge(mask, hop, sr, min_ms):
    """True 인 프레임들을 구간 [start_sample, end_sample) 목록으로 묶는다."""
    segs, i, n = [], 0, len(mask)
    while i < n:
        if not mask[i]:
            i += 1
            continue
        j = i
        while j < n and mask[j]:
            j += 1
        s, e = i * hop, min(len(mask) * hop + hop, j * hop)
        if (e - s) / sr * 1000 >= min_ms:
            segs.append([s, e])
        i = j
    return segs


def analyze(a, sr, args):
    db, hop, win = envelope(a, sr)
    if db.size == 0:
        raise SystemExit("오디오가 너무 짧습니다")

    speech_ref = float(np.percentile(db, 75))   # 말하는 구간의 대표 음량
    floor = float(np.percentile(db, 5))         # 이 녹음의 바닥 잡음

    pause_th = speech_ref - args.pause_drop     # 이보다 조용하면 '말이 쉬는 중'
    breath_th = floor + args.breath_over        # 바닥보다 이만큼 크면 '뭔가 들린다'

    pause_mask = db < pause_th
    pauses = merge(pause_mask, hop, sr, args.min_pause_ms)

    flat, hf, zcr = features(a, sr)
    nf = min(len(db), len(flat))

    # 말하는 프레임의 평탄도 분포 — 판정 기준을 이 녹음에서 직접 뽑는다
    speech_frames = db[:nf] > (speech_ref - 6)
    speech_flat = float(np.median(flat[:nf][speech_frames])) if speech_frames.any() else 0.0

    cands, breaths = [], []
    for ps, pe in pauses:
        f0, f1 = ps // hop, max(ps // hop + 1, pe // hop)
        f1 = min(f1, nf)
        if f1 <= f0:
            continue
        m = db[f0:f1] > breath_th
        for bs, be in merge(m, hop, sr, args.min_breath_ms):
            s, e = ps + bs, min(pe, ps + be)
            if e <= s:
                continue
            g0, g1 = min(f0 + bs // hop, nf - 1), min(max(f0 + bs // hop + 1, f0 + be // hop), nf)
            seg = a[s:e]
            item = {
                "start": s, "end": e, "t0": s / sr, "t1": e / sr,
                "pause_start": ps, "pause_end": pe,
                "pause_ms": (pe - ps) / sr * 1000,
                "ms": (e - s) / sr * 1000,
                "peak_db": float(20 * np.log10(np.max(np.abs(seg)) + 1e-12)),
                "rms_db": float(np.median(db[g0:g1])),
                "flat": float(np.median(flat[g0:g1])),
                "hf": float(np.median(hf[g0:g1])),
                "zcr": float(np.median(zcr[g0:g1])),
            }
            # 🔑 이 녹음에서 실측해 보니 **고역비율**이 가장 깨끗하게 갈렸다.
            #    숨(넓은 대역 잡음) = 0.34~0.58 · 룸톤/웅웅거림(저역만) = 0.00~0.03
            #    평탄도는 저역이 강한 녹음에서 눌려 변별력이 떨어진다(참고값으로만 남긴다).
            item["is_breath"] = item["hf"] >= args.min_hf and item["zcr"] >= args.min_zcr
            cands.append(item)
            if item["is_breath"]:
                breaths.append(item)

    return {"db": db, "hop": hop, "speech_ref": speech_ref, "floor": floor,
            "pause_th": pause_th, "breath_th": breath_th, "speech_flat": speech_flat,
            "pauses": pauses, "breaths": breaths, "cands": cands}


def timeline(a, sr, breaths, width=78):
    """말=■ 쉼=· 숨=B 로 한 줄 그림."""
    db, hop, _ = envelope(a, sr)
    total = len(a)
    marks = np.zeros(total, dtype=np.uint8)
    for b in breaths:
        marks[b["start"]:b["end"]] = 1
    out = []
    for i in range(width):
        s = int(total * i / width)
        e = max(s + 1, int(total * (i + 1) / width))
        if marks[s:e].any():
            out.append("B")
        else:
            seg = a[s:e]
            r = 20 * np.log10(np.sqrt(np.mean(seg ** 2) + 1e-12) + 1e-12)
            out.append("#" if r > np.percentile(db, 60) else ("-" if r > np.percentile(db, 20) else "."))
    return "".join(out)


def apply_removal(pcm, sr, breaths, args):
    """int16 원본에서 숨 구간만 눕힌다 — 나머지 샘플은 **비트 단위로 그대로**.

    🔴 숨을 완전 무음으로 만들었더니 바로 뒤 낱말(「훌륭한」)이 뚝 시작해 발음이
       뭉개진 것처럼 들렸다(로이가 원본과 대조해 발견). 숨은 잡음일 뿐 아니라
       **낱말로 들어가는 진입 경사** 노릇을 하고 있었다.
       → 뒤쪽(말로 이어지는 쪽) 경사를 길게(`--lead-ms`) 두고, 바닥도 완전 0 대신
         잔향을 조금 남길 수 있게(`--residual`) 했다.

    ⚠ 탐지 경계는 20ms 창으로 재기 때문에 **말꼬리 쪽으로 조금 번진다.** 경계에서 바로
      페이드를 시작하면 앞 낱말의 끝이 2dB 남짓 깎인다(실측). 그래서 앞머리에
      `--guard-ms` 만큼 **손대지 않는 여유**를 두고 그 뒤부터 눕힌다.
    """
    out = pcm.copy()
    for b in breaths:
        s, e = b["start"], b["end"]
        n = e - s
        # 🔑 여유·경사는 **말과 맞닿을 때만** 필요하다. 숨이 쉼 한가운데 있어 앞뒤로 이미
        #    무음이 넉넉하면 그만큼 빼준다. 안 그러면 짧은 숨(<200ms)은 여유+경사가
        #    구간 전체를 먹어 **완전 무음 구간이 아예 안 생긴다**(실측: 8dB 밖에 안 줄었다).
        pre = s - b.get("pause_start", s)     # 앞선 말과 숨 사이에 이미 있는 무음
        post = b.get("pause_end", e) - e      # 숨과 다음 말 사이에 이미 있는 무음
        gd = max(0, int(sr * args.guard_ms / 1000) - pre)
        fo = max(int(sr * 0.008), int(sr * args.lead_ms / 1000) - post)
        fi = int(sr * args.fade_ms / 1000)
        tot = gd + fi + fo
        if tot > n:                      # 그래도 넘치면 비례 축소
            k = n / tot
            gd, fi, fo = int(gd * k), int(fi * k), int(fo * k)
        g = np.full(n, args.residual, dtype=np.float32)
        if gd > 0:
            g[:gd] = 1.0                 # 말꼬리 보호 — 원본 그대로
        if fi > 0:
            g[gd:gd + fi] = np.linspace(1.0, args.residual, fi)
        if fo > 0:
            g[n - fo:] = np.linspace(args.residual, 1.0, fo)
        out[s:e] = np.round(out[s:e].astype(np.float32) * g).astype("<i2")
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("wav")
    p.add_argument("--apply", action="store_true", help="실제로 제거해 새 파일 저장")
    p.add_argument("--pause-drop", type=float, default=14.0, help="말 대표음량보다 이만큼 낮으면 쉼 (dB)")
    p.add_argument("--breath-over", type=float, default=6.0, help="바닥잡음보다 이만큼 크면 숨 (dB)")
    # 🔴 120 으로 뒀다가 "좋아합니다"의 「ㅎ」을 숨으로 오인해 지웠다(로이가 청취로 발견).
    #    낱말 안의 음량 저하도 120ms 쉼으로 잡혔던 것. 이 녹음 실측 = 오탐 120ms vs 진짜 숨 335ms+
    #    → 250 이면 둘 사이가 깨끗하게 갈린다. **쉼 판정이 느슨하면 마찰음이 숨으로 둔갑한다.**
    p.add_argument("--min-pause-ms", type=float, default=250.0)
    p.add_argument("--min-breath-ms", type=float, default=60.0)
    p.add_argument("--guard-ms", type=float, default=40.0,
                   help="숨 앞머리에서 손대지 않을 여유 — 앞 낱말의 끝을 보호한다")
    p.add_argument("--fade-ms", type=float, default=8.0, help="숨 시작쪽 경사(짧아도 된다)")
    p.add_argument("--lead-ms", type=float, default=60.0,
                   help="말로 이어지는 쪽 경사 — 짧으면 다음 낱말이 뚝 시작한다")
    p.add_argument("--residual", type=float, default=0.0, help="0=완전 무음, 0.15=15%만 남김")
    p.add_argument("--min-flat", type=float, default=0.10, help="(참고) 스펙트럼 평탄도")
    p.add_argument("--flat-ratio", type=float, default=2.0, help="(참고) 말소리 평탄도 대비 배수")
    p.add_argument("--min-hf", type=float, default=0.25, help="숨 판정: 1.5kHz 이상 에너지 비중")
    p.add_argument("--min-zcr", type=float, default=0.08, help="숨 판정: 최소 영교차율")
    p.add_argument("--preview", action="store_true", help="지울 소리만 모은 확인용 파일도 만든다")
    p.add_argument("--out", default=None)
    args = p.parse_args()

    a, pcm, sr, ch, sw = read_wav(args.wav)
    r = analyze(a, sr, args)
    b, cands = r["breaths"], r["cands"]

    print(f"파일   : {args.wav}")
    print(f"형식   : {sr}Hz {ch}ch {sw*8}bit · {len(a)/sr:.2f}초")
    print(f"음량   : 말 {r['speech_ref']:.1f}dB · 바닥 {r['floor']:.1f}dB")
    print(f"기준선 : 쉼 <{r['pause_th']:.1f}dB · 숨 >{r['breath_th']:.1f}dB")
    print(f"판정선 : 고역비 ≥{args.min_hf:.2f} 이고 ZCR ≥{args.min_zcr:.2f} 이면 숨 "
          f"(말소리 평탄도 중앙값 {r['speech_flat']:.3f})")
    print(f"쉼 구간: {len(r['pauses'])}개")
    print()
    print("  " + timeline(a, sr, b))
    print("  (# 말  - 약한소리  . 무음  B 숨으로 판정)")
    print()

    print(f"쉼 속 소리 {len(cands)}개 중 숨 판정 {len(b)}개")
    print(f"{'#':>3} {'판정':>4} {'시작':>7} {'끝':>7} {'길이':>7} {'쉼길이':>8} {'레벨':>8} {'고역비':>6} {'ZCR':>6}")
    for i, x in enumerate(cands, 1):
        mark = "숨" if x["is_breath"] else " ·"
        print(f"{i:>3} {mark:>4} {x['t0']:>6.2f}s {x['t1']:>6.2f}s {x['ms']:>6.0f}ms "
              f"{x['pause_ms']:>7.0f}ms {x['rms_db']:>7.1f}dB {x['hf']:>6.2f} {x['zcr']:>6.3f}")

    if not b:
        print("\n숨으로 판정된 구간이 없습니다. --flat-ratio 를 낮춰 보세요(예: 1.5).")
        return 0

    tot = sum(x["ms"] for x in b)
    print(f"\n제거 대상 합계 {tot:.0f}ms ({tot / (len(a)/sr) / 10:.1f}%)")

    if args.preview:
        gap = np.zeros(int(sr * 0.25), dtype="<i2")
        only = np.concatenate([np.concatenate([pcm[x["start"]:x["end"]], gap]) for x in b])
        pv = os.path.splitext(args.wav)[0] + "_breathsOnly.wav"
        write_wav(pv, only, sr)
        print(f"확인용: {pv}  ← 여기서 숨소리만 들리면 안전, 말이 섞이면 과하게 잡은 것")

    if not args.apply:
        print("\n(탐지만 했습니다. 실제로 지우려면 --apply)")
        return 0

    out = apply_removal(pcm, sr, b, args)
    dst = args.out or os.path.splitext(args.wav)[0] + "_noBreath.wav"
    write_wav(dst, out, sr)
    print(f"\n저장 : {dst}")
    print(f"원본 : {args.wav} (수정하지 않음)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
