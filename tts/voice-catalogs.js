'use strict';

/**
 * voice-catalogs.js — 🔊 음성 엔진 팝업의 **내장 목소리 목록**(API 로 목록을 주지 않는 엔진)
 *
 *   - Gemini : 기본 목소리 30개 — 이름·특징은 ai.google.dev/gemini-api/docs/speech-generation 「Voice options」 그대로.
 *              성별은 공식 표기가 없어 커뮤니티 청취 기준(옛 gemini-provider.getVoices 와 같은 값).
 *              ➕ 확장 라이브러리(수백 개)는 API(GET /v1beta/voices)로 불러온다(main · gemini-voices).
 *   - MAI    : learn.microsoft.com/azure/ai-services/speech-service/mai-voices 「Managed voices and styles」 표 전체
 *              (2026-09-30 판 · 97개 · 모든 목소리가 MAI-Voice-2.1 · 2.1-Flash 둘 다 지원).
 *   타입캐스트·ElevenLabs 는 계정마다 목록이 달라 API 로 불러온다(내장 목록 없음).
 *
 * 카드 하나 = { id, name, gender:'male'|'female'|'', lang, desc, styles? }
 */

const GEMINI_RAW = [
  ['Zephyr', 'Bright', '밝은', 'female'], ['Puck', 'Upbeat', '경쾌한', 'male'], ['Charon', 'Informative', '정보 전달', 'male'],
  ['Kore', 'Firm', '단단한', 'female'], ['Fenrir', 'Excitable', '들뜬', 'male'], ['Leda', 'Youthful', '젊은', 'female'],
  ['Orus', 'Firm', '단단한', 'male'], ['Aoede', 'Breezy', '산뜻한', 'female'], ['Callirrhoe', 'Easy-going', '느긋한', 'female'],
  ['Autonoe', 'Bright', '밝은', 'female'], ['Enceladus', 'Breathy', '숨결 섞인', 'male'], ['Iapetus', 'Clear', '또렷한', 'male'],
  ['Umbriel', 'Easy-going', '느긋한', 'male'], ['Algieba', 'Smooth', '매끄러운', 'male'], ['Despina', 'Smooth', '매끄러운', 'female'],
  ['Erinome', 'Clear', '또렷한', 'female'], ['Algenib', 'Gravelly', '거친', 'male'], ['Rasalgethi', 'Informative', '정보 전달', 'male'],
  ['Laomedeia', 'Upbeat', '경쾌한', 'female'], ['Achernar', 'Soft', '부드러운', 'female'], ['Alnilam', 'Firm', '단단한', 'male'],
  ['Schedar', 'Even', '고른', 'male'], ['Gacrux', 'Mature', '성숙한', 'female'], ['Pulcherrima', 'Forward', '적극적인', 'female'],
  ['Achird', 'Friendly', '친근한', 'male'], ['Zubenelgenubi', 'Casual', '편안한', 'male'], ['Vindemiatrix', 'Gentle', '온화한', 'female'],
  ['Sadachbia', 'Lively', '활기찬', 'male'], ['Sadaltager', 'Knowledgeable', '박식한', 'male'], ['Sulafat', 'Warm', '따뜻한', 'female'],
];
const GEMINI = GEMINI_RAW.map(([id, en, ko, g]) => ({ id, name: id, gender: g, lang: '다국어', desc: `${ko} (${en})` }));

// ── MAI-Voice — 공식 표 그대로 ───────────────────────────────────────────────
const S_NARR = 'agent,audiobook,customer_call_center,educational,narrator,neutral';
const S_EMO = 'angry,confused,determined,disgusted,embarrassed,excited,fearful,happy,hopeful,jealous,joyful,neutral,regretful,relieved,sad,shouting,softvoice,surprised,whispering';
const S_11 = 'adventurous,caringempathy,curious,encouraging,excited,friendlycheerful,neutral,nostalgic,reflective,saddisappointed,serious';
const LANG_KO = {
  'cs-CZ': '체코어', 'da-DK': '덴마크어', 'de-DE': '독일어', 'en-AU': '영어(호주)', 'en-GB': '영어(영국)', 'en-IN': '영어(인도)', 'en-US': '영어(미국)',
  'es-ES': '스페인어(스페인)', 'es-MX': '스페인어(멕시코)', 'fi-FI': '핀란드어', 'fr-FR': '프랑스어', 'hi-IN': '힌디어', 'hu-HU': '헝가리어',
  'id-ID': '인도네시아어', 'it-IT': '이탈리아어', 'ko-KR': '한국어', 'nb-NO': '노르웨이어', 'nl-NL': '네덜란드어', 'pl-PL': '폴란드어',
  'pt-BR': '포르투갈어(브라질)', 'pt-PT': '포르투갈어(포르투갈)', 'ro-RO': '루마니아어', 'ru-RU': '러시아어', 'sv-SE': '스웨덴어',
  'th-TH': '태국어', 'tr-TR': '튀르키예어', 'vi-VN': '베트남어', 'zh-CN': '중국어(간체)',
};
// [목소리 id, 성별 M/F, 말투 목록]
const MAI_RAW = [
  ['cs-CZ-Grant', 'M', S_NARR], ['cs-CZ-Harper', 'F', S_NARR],
  ['da-DK-Grant', 'M', 'agent,customer_call_center,educational,narrator,neutral'], ['da-DK-Harper', 'F', S_NARR],
  ['de-DE-Grant', 'M', S_NARR], ['de-DE-Harper', 'F', S_NARR], ['de-DE-Klaus', 'M', S_EMO], ['de-DE-Mia', 'F', S_EMO],
  ['en-AU-Isla', 'F', S_EMO],
  ['en-GB-Emily', 'F', 'agent,angry,audiobook,confused,customer_call_center,disgusted,educational,embarrassed,excited,fearful,happy,jealous,joyful,narrator,neutral,sad,surprised'],
  ['en-GB-Harry', 'M', 'agent,angry,audiobook,customer_call_center,disgusted,educational,fearful,joyful,narrator,neutral,sad,surprised'],
  ['en-IN-Dhruv', 'M', 'neutral'], ['en-IN-Priya', 'F', 'neutral'],
  ['en-US-Ethan', 'M', S_EMO], ['en-US-Grant', 'M', S_NARR],
  ['en-US-Harper', 'F', 'agent,angry,audiobook,confused,customer_call_center,determined,educational,embarrassed,excited,happy,hopeful,joyful,narrator,neutral,regretful,relieved,sad,shouting,softvoice,whispering'],
  ['en-US-Iris', 'F', 'neutral'], ['en-US-Jasper', 'M', 'neutral'], ['en-US-Olivia', 'F', S_EMO], ['en-US-Sage', 'M', S_NARR],
  ['es-ES-Marta', 'F', S_11],
  ['es-MX-Alejo', 'M', S_EMO], ['es-MX-Grant', 'M', 'neutral'], ['es-MX-Harper', 'F', S_NARR], ['es-MX-Valeria', 'F', S_EMO],
  ['fi-FI-Grant', 'M', 'neutral'], ['fi-FI-Harper', 'F', S_NARR],
  ['fr-FR-Grant', 'M', 'neutral'], ['fr-FR-Harper', 'F', S_NARR], ['fr-FR-Marc', 'M', S_EMO], ['fr-FR-Soleil', 'F', S_EMO],
  ['hi-IN-Arjun', 'M', 'angry,confused,disgusted,embarrassed,excited,fearful,happy,hopeful,jealous,joyful,neutral,regretful,sad,surprised'],
  ['hi-IN-Dhruv', 'M', S_EMO], ['hi-IN-Grant', 'M', 'audiobook,neutral'], ['hi-IN-Harper', 'F', 'agent,customer_call_center,educational,narrator,neutral'],
  ['hi-IN-Kavya', 'F', S_EMO], ['hi-IN-Priya', 'F', S_EMO],
  ['hu-HU-Bence', 'M', 'neutral'], ['hu-HU-Grant', 'M', 'neutral'], ['hu-HU-Harper', 'F', S_NARR], ['hu-HU-Levente', 'M', 'neutral'],
  ['hu-HU-Lilla', 'F', 'neutral'], ['hu-HU-Reka', 'F', 'neutral'],
  ['id-ID-Grant', 'M', S_NARR], ['id-ID-Harper', 'F', 'neutral'],
  ['it-IT-Grant', 'M', 'audiobook,educational,neutral'], ['it-IT-Harper', 'F', 'agent,customer_call_center,narrator,neutral'],
  ['it-IT-Luca', 'M', S_EMO], ['it-IT-Rosa', 'F', S_EMO],
  ['ko-KR-Grant', 'M', S_NARR],
  ['ko-KR-Haena', 'F', 'angry,confused,determined,embarrassed,excited,happy,hopeful,joyful,neutral,regretful,relieved,sad,softvoice,surprised'],
  ['ko-KR-Harper', 'F', S_NARR],
  ['ko-KR-Junho', 'M', 'angry,confused,determined,embarrassed,excited,happy,hopeful,joyful,neutral,relieved,sad,softvoice'],
  ['nb-NO-Grant', 'M', 'educational,neutral'], ['nb-NO-Harper', 'F', 'agent,audiobook,customer_call_center,narrator,neutral'],
  ['nl-NL-Grant', 'M', 'agent,customer_call_center,educational,narrator,neutral'], ['nl-NL-Harper', 'F', S_NARR], ['nl-NL-Sander', 'M', S_11],
  ['pl-PL-Grant', 'M', 'neutral'], ['pl-PL-Harper', 'F', S_NARR],
  ['pt-BR-Caio', 'M', S_EMO], ['pt-BR-Grant', 'M', 'agent,customer_call_center,educational,neutral'], ['pt-BR-Harper', 'F', 'audiobook,narrator,neutral'],
  ['pt-BR-Luana', 'F', S_EMO],
  ['pt-BR-Pedro', 'M', 'confused,determined,embarrassed,excited,happy,hopeful,joyful,neutral,regretful,relieved,sad,softvoice,surprised'],
  ['pt-BR-Rafael', 'M', 'angry,confused,determined,embarrassed,excited,happy,hopeful,joyful,neutral,regretful,relieved,sad,softvoice,surprised'],
  ['pt-PT-Grant', 'M', 'neutral'], ['pt-PT-Harper', 'F', 'neutral'],
  ['pt-PT-Rui', 'M', 'angry,confused,determined,embarrassed,excited,happy,hopeful,joyful,neutral,regretful,relieved,sad,softvoice,surprised'],
  ['ro-RO-Andrei', 'M', 'neutral'], ['ro-RO-Elena', 'F', 'neutral'], ['ro-RO-Grant', 'M', 'agent,customer_call_center,educational,narrator,neutral'],
  ['ro-RO-Harper', 'F', 'audiobook,neutral'], ['ro-RO-Ioana', 'F', 'neutral'], ['ro-RO-Radu', 'M', 'neutral'],
  ['ru-RU-Grant', 'M', 'agent,customer_call_center,neutral'], ['ru-RU-Harper', 'F', 'audiobook,educational,narrator,neutral'],
  ['ru-RU-Lev', 'M', S_11], ['ru-RU-Masha', 'F', S_11],
  ['sv-SE-Grant', 'M', 'neutral'], ['sv-SE-Harper', 'F', S_NARR],
  ['th-TH-Grant', 'M', S_NARR], ['th-TH-Harper', 'F', S_NARR], ['th-TH-Krit', 'F', S_11], ['th-TH-Nattapong', 'M', S_11],
  ['tr-TR-Aydin', 'M', S_11], ['tr-TR-Elif', 'F', S_11], ['tr-TR-Grant', 'M', 'educational,narrator,neutral'],
  ['tr-TR-Harper', 'F', 'agent,audiobook,customer_call_center,neutral'],
  ['vi-VN-Grant', 'M', 'agent,customer_call_center,educational,narrator,neutral'], ['vi-VN-Harper', 'F', 'audiobook,neutral'],
  ['zh-CN-Bo', 'M', S_EMO], ['zh-CN-Grant', 'M', S_NARR], ['zh-CN-Harper', 'F', S_NARR],
  ['zh-CN-Lan', 'F', 'angry,confused,disgusted,embarrassed,excited,fearful,happy,joyful,neutral,sad,surprised'],
  ['zh-CN-Mei', 'F', S_EMO],
  ['zh-CN-Wei', 'M', 'angry,confused,disgusted,embarrassed,excited,fearful,happy,hopeful,jealous,joyful,neutral,regretful,sad,surprised'],
];
// 한국어 이름이 있는 목소리(카드 제목)
const MAI_KO_NAME = { 'ko-KR-Junho': '준호', 'ko-KR-Haena': '해나' };
const MAI = MAI_RAW.map(([id, g, st]) => {
  const loc = id.split('-').slice(0, 2).join('-');
  const nm = id.split('-').slice(2).join('-');
  const styles = st.split(',');
  const kind = st === S_NARR ? '낭독·교육용' : styles.length >= 11 ? '감정 표현' : styles.length === 1 ? '기본' : '';
  return { id, name: MAI_KO_NAME[id] ? `${MAI_KO_NAME[id]} (${nm})` : nm, gender: g === 'M' ? 'male' : 'female', lang: LANG_KO[loc] || loc, locale: loc, desc: kind ? `${kind} · 말투 ${styles.length}가지` : `말투 ${styles.length}가지`, styles };
});

module.exports = { GEMINI, MAI, MAI_LANGS: LANG_KO };
