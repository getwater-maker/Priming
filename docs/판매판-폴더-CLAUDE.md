# Priming 판매판 폴더 — 규칙 (이 파일은 복사본이다)

> 🔴 **이 폴더는 로이판(`D:\Priming`)에서 한 방향으로 복사된 판매판이다.** 원본 = `D:\Priming\docs\판매판-폴더-CLAUDE.md` · 복사 = `D:\Priming\scripts\export-member.js`.
> 이 파일을 포함해 이 폴더의 파일을 고쳐도 다음 「판매판 올려」 때 **전부 덮인다**.

## 이 폴더는 무엇인가
- 저장소 = `getwater-maker/Priming-Member`(비공개). **회원(판매판) 업데이트와 설치본은 이 저장소에서만 나간다.**
  - 회원 앱(`edition.json` = member)은 업데이트 Worker(`updates.primingwave.com`)에 `edition=member` 로 묻고, Worker 가 이 저장소의 `update-manifest.json` 과 파일을 준다.
  - 설치본 `Priming-Setup-<버전>.exe` 는 이 저장소의 Release `member-v<버전>` 에 있다.
- 로이판(관리자 · 로이 PC 두 대) = `D:\Priming` → 저장소 `getwater-maker/Priming`. **코드는 거기서만 고친다.**

## ⛔ 하지 않는 것
- ⛔ **이 폴더에서 코드·문서를 고치지 않는다**(복사 때 덮인다 · 두 벌이 되면 고친 것이 사라지거나 판이 갈린다). 고칠 것이 있으면 로이판 세션에 요청서(무엇을·왜·어느 파일)로 넘긴다.
- ⛔ 이 폴더에서 손으로 커밋·푸시·태그하지 않는다 — 올리기는 로이판의 `npm run release:member -- --confirm` 한 길이다(로이 「판매판 올려」 때만).
- ⛔ `update-manifest.json` 을 손으로 고치지 않는다(해시가 어긋나면 모든 회원 PC 의 업데이트가 멈춘다).

## 이 폴더 세션이 맡는 것
- **판매판 시험**: 이 폴더 그대로 켜 보기(`edition.json` = member 이므로 판매판으로 뜬다 · 의존성은 `npm ci` 로 따로 받는다) · 롱폼 만들기 확인 · 회원 화면 확인.
  - 자동 시험은 로이판에서: `cd D:\Priming` 뒤 `node test/edition.test.js --dir D:\Priming-Member`(금지 파일·금지 문자열 · 매니페스트와 폴더 일치 · 이 폴더 파일만으로 켜기 · 롱폼 무음 만들기).
- **발행 확인**: 올린 뒤 회원 계정 앱의 업데이트 한 번 · 사이트 `www.primingwave.com/member/devices` 내려받기 카드.
- **회원 대응**: 회원 오류 로그·문의를 읽고 원인을 정리해 로이판 세션에 요청서로 넘긴다.

## 대화
- 대화·보고는 한국어로 한다. 시각은 KST.
