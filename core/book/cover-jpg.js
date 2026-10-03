'use strict';
/**
 * cover-jpg.js — 🖼 부크크 표지 업로드용 JPG 만들기.
 *   부크크 3단계(직접 올리기)·전자책 표지 업로드 형식은 **JPG · PDF 뿐**(PNG 불가 — 「파일 확장자를 확인해주세요!」 · 10MB 이하)이다(로이 2026-10-03).
 *   PNG·WebP 원본이 지정된 경우(원고 메타 `> 전자책표지:`) 업로드 직전에 JPG 로 바꿔 쓴다. ffmpeg 비동기(메인 프로세스에서 동기 자식 프로세스 금지).
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const MAX_BYTES = 10 * 1024 * 1024 - 256 * 1024;   // 부크크 10MB 한도 여유

/** src(png/webp/jpg…) → outJpg. 10MB 를 넘으면 품질을 낮춰 다시. 성공하면 outJpg, 실패하면 null */
async function toUploadJpg(src, outJpg) {
  try {
    const ff = require('../media-utils').getFfmpegPath();
    if (!ff || !fs.existsSync(src)) return null;
    fs.mkdirSync(path.dirname(outJpg), { recursive: true });
    for (const q of ['2', '4', '7', '12']) {   // ffmpeg mjpeg -q:v (낮을수록 고품질)
      await new Promise((res, rej) => execFile(ff, ['-y', '-i', src, '-frames:v', '1', '-q:v', q, '-pix_fmt', 'yuvj420p', outJpg], { windowsHide: true }, (e) => (e ? rej(e) : res())));
      if (fs.existsSync(outJpg) && fs.statSync(outJpg).size <= MAX_BYTES) return outJpg;
    }
    return fs.existsSync(outJpg) ? null : null;   // 가장 낮은 품질도 10MB 초과 → 올리지 않는다
  } catch (_) { return null; }
}
module.exports = { toUploadJpg, MAX_BYTES };
