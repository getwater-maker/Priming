'use strict';
const crypto = require('crypto');
const { normalizeIsbn13 } = require('./isbn-barcode');
const DK = require('./date-ko');
const b64 = s => Buffer.from(s || '', 'base64url').toString('utf8');
const clean = s => String(s || '').replace(/[\r\n]/g, ' ').trim();
function address(s) { const m = clean(s).match(/(?:<|^)([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})(?:>|$)/i); if (!m) throw Error('회신 주소를 확인할 수 없습니다'); return m[1].toLowerCase(); }
function message(m) {
  const h = name => ((m.payload && m.payload.headers || []).find(x => x.name.toLowerCase() === name) || {}).value || '';
  function body(p) {
    if (!p) return '';
    if (p.mimeType === 'text/plain') return b64(p.body && p.body.data);
    const parts = p.parts || []; const plain = parts.filter(x => x.mimeType !== 'text/html').map(body).filter(Boolean).join('\n');
    if (plain) return plain;
    if (p.mimeType === 'text/html') return b64(p.body && p.body.data).replace(/<(br|\/p|\/div)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    return parts.map(body).filter(Boolean).join('\n');
  }
  return { id: m.id, threadId: m.threadId, subject: h('subject'), from: h('from'), replyTo: h('reply-to') || h('from'), messageId: clean(h('message-id')), references: clean(h('references')), date: h('date'), at: Number(m.internalDate) || Date.parse(h('date')) || 0, text: body(m.payload).slice(0, 100000) };
}
function extract(text) {
  // 인용된 옛 답장·서명의 날짜를 현재 요청으로 해석하지 않는다.
  const current = String(text || '').split(/\n(?:On .+wrote:|-----Original Message-----|보낸 사람\s*:|From\s*:)/i)[0].split('\n').filter(l => !/^\s*>/.test(l)).join('\n');
  const isbns = [...new Set((current.match(/97[89](?:[\s-]*\d){10}/g) || []).map(normalizeIsbn13).filter(Boolean))];
  const dates = [];
  for (const line of current.split('\n').filter(l => /발행\s*일|출간\s*일/.test(l))) {
    for (const m of line.matchAll(/((?:19|20)\d{2})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})\s*일?/g)) {
      const y = +m[1], mo = +m[2], d = +m[3], v = new Date(Date.UTC(y, mo - 1, d));
      if (v.getUTCFullYear() === y && v.getUTCMonth() === mo - 1 && v.getUTCDate() === d) dates.push(DK.formatKo(`${y}-${mo}-${d}`));
    }
  }
  const ds = [...new Set(dates)];
  return { isbn: isbns.length === 1 ? isbns[0] : '', issueDate: ds.length === 1 ? ds[0] : '', ambiguous: isbns.length > 1 || ds.length > 1, note: isbns.length > 1 || ds.length > 1 ? 'ISBN 또는 발행일이 여러 개입니다. 해당 책·판의 값을 직접 확인하세요.' : '메일의 책·권·종이책/전자책 및 추가 수정 요청을 확인하세요.' };
}
function validate(isbn, date) {
  const x = extract(`ISBN: ${isbn}\n발행일: ${date}`);
  if (!x.isbn || !x.issueDate || x.ambiguous || !/^(?:97[89])\d{10}$/.test(String(isbn).replace(/[\s-]/g, ''))) throw Error('유효한 ISBN-13과 발행일을 입력하세요');
  return x;
}
function mime({ email, original, body, files, id }) {
  const to = address(original.replyTo), boundary = 'priming_' + crypto.randomBytes(16).toString('hex');
  if (!/^<[^<>\s]+@[^<>\s]+>$/.test(original.messageId)) throw Error('원본 메일 Message-ID가 없어 회신을 연결할 수 없습니다');
  const enc = v => '=?UTF-8?B?' + Buffer.from(v).toString('base64') + '?=';
  const wrap = b => b.toString('base64').match(/.{1,76}/g).join('\r\n');
  const lines = [`From: ${address(email)}`, `To: ${to}`, `Subject: ${enc(/^Re:/i.test(original.subject) ? clean(original.subject) : 'Re: ' + clean(original.subject))}`, `Message-ID: <${id}@priming.local>`, `In-Reply-To: ${original.messageId}`, `References: ${clean(original.references)} ${original.messageId}`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(Buffer.from(body))];
  for (const f of files) lines.push(`--${boundary}`, 'Content-Type: application/pdf', 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`, '', wrap(f.buffer));
  lines.push(`--${boundary}--`, '');
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}
module.exports = { message, extract, validate, mime, address };
