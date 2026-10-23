"use client";

/**
 * 계정 — 모바일 셸 화이트 리디자인(2026-10-15, 시안 Account-Phone). `/account?mode=mobile`(또는 모바일이 기본인 사람)일 때만 쓴다.
 * 관리 콘솔(PC) 쪽은 기존 탭 화면(AccountSettings) 그대로다.
 *
 * 실제 있는 기능만 묶음 줄로: 내 정보(이름 · 생년월일 · 전화번호 · 성별 → 줄을 누르면 공용 BottomSheet 에서 고침, 언어는 바로 바뀌는 3칸)
 * · 조직(이름 · 역할, 읽기만) · 앱(하단 탭 편집 → 셸의 편집 시트) · 게시판(차단한 사용자 · 내가 신고한 글 · 댓글 → 시트 안 기존 목록)
 * · 도움(제안함 · 버그 신고 · 이용약관 · 개인정보 처리방침 · 고객지원) → 회색 「로그아웃」 · 작은 빨간 「계정 삭제」(기존 확인 시트) · 버전.
 *
 * 저장은 기존 `updateAccountProfile` 그대로다 — 이 액션은 이름 · 전화 · 성별 · 언어를 한꺼번에 받으므로, 한 칸만 고칠 때도 나머지는
 * 지금 값을 숨은 칸으로 함께 보낸다. See docs/product/17-user-profile-directory.md 「계정 화면 — 화이트 리디자인(모바일)」.
 */

import Link from "next/link";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateAccountProfile } from "@/app/account/actions";
import { signOut } from "@/app/auth/actions";
import { BlockedUsersList } from "@/components/account/blocked-users-list";
import { DeleteAccountSheet } from "@/components/account/delete-account-sheet";
import { MyReportsList, type MyReportRow } from "@/components/account/my-reports-list";
import { BottomSheet } from "@/components/shell/bottom-sheet";
import {
  IdentityNamesFields,
  type IdentityCopy,
} from "@/components/identity/identity-names-fields";
import {
  normalizeIdentityNames,
  validateIdentityNames,
  type IdentityNames,
} from "@/lib/identity-names";
import type { Locale } from "@/lib/i18n";
import { getNativeAppInfo } from "@/lib/native-app";
import "./account-white.css";

type Gender = "female" | "male";
type Field = "name" | "birthDate" | "phoneNumber" | "gender";

export type AccountMobileCopy = {
  white: {
    secProfile: string; secOrg: string; secApp: string; secBoard: string; secHelp: string; notSet: string; bottomTabs: string;
    blocked: string; blockedCount: string; reports: string; reportsCount: string; editHint: string; save: string; cancel: string;
    version: string; versionWeb: string;
  };
  name: string; birthDate: string; birthDateHint: string; phone: string; phoneHint: string; gender: string; genderHint: string;
  genderOptions: Record<Gender, string>; language: string; languages: Record<Locale, string>;
  organizationName: string; role: string; logout: string; saved: string; errorText: string | null;
  incomplete: { title: string; body: string } | null;
  /** 국적 + 이름 세 가지(docs/product/41 §2) — 「이름」 줄을 누르면 이 칸들을 고친다. */
  identity: IdentityCopy;
  blockedList: { title: string; body: string; empty: string; unblock: string; unknown: string };
  reportsList: { title: string; body: string; empty: string; withdraw: string; unknown: string };
  deleteSheet: {
    cancel: string; deleteAccount: string; deleteAccountTitle: string; deleteAccountDesc: string; deleteAccountWarning: string;
    deleteAccountConfirm: string;
  };
};

type Props = {
  user: {
    name: string;
    birthDate: string | null;
    phoneNumber: string;
    gender: Gender | null;
    language: Locale;
    identity: IdentityNames;
    /** 국적 · 이름이 비었거나 규칙에 안 맞음 — 맨 위에 채워 달라는 줄을 띄운다. */
    identityIncomplete: boolean;
  };
  organization: { name: string; role: string };
  bottomTabsLabel: string;
  blockedUsers: { id: string; name: string }[];
  myReports: MyReportRow[];
  help: { href: string; label: string }[];
  saved: boolean;
  copy: AccountMobileCopy;
  /** `?fill=identity` 로 왔으면 이름(국적 · 이름 세 가지) 시트를 바로 연다. */
  openIdentity?: boolean;
  /** 신분 서류 줄(재류카드 · 마이넘버 카드) — 조직 멤버만. 누르면 등록 · 보기 화면(docs/product/41 R2). */
  idCard?: { label: string; value: string; missing: boolean } | null;
};

const LANGS: Locale[] = ["ko", "ja", "en"];

const CHEVRON = (
  <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

function formatBirth(value: string, locale: Locale) {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" }).format(d);
}

/** 이 화면이 보내는 모든 값 — 고치는 칸 하나만 빼고 숨은 칸으로. */
function HiddenProfile({ user, except, language }: { user: Props["user"]; except?: Field; language?: Locale }) {
  return (
    <>
      <input name="mode" type="hidden" value="mobile" />
      {except !== "name" ? <input name="name" type="hidden" value={user.name} /> : null}
      {except !== "birthDate" ? <input name="birthDate" type="hidden" value={user.birthDate ?? ""} /> : null}
      {except !== "phoneNumber" ? <input name="phoneNumber" type="hidden" value={user.phoneNumber} /> : null}
      {except !== "gender" ? <input name="gender" type="hidden" value={user.gender ?? ""} /> : null}
      <input name="preferredLanguage" type="hidden" value={language ?? user.language} />
    </>
  );
}

/** 「이름」 시트 — 국적 + 한국어 · 영문 · 가타카나. 나라 목록은 시트 안에 펼친다(시트 위에 시트 금지). */
function IdentitySheetFields({ copy, locale, initial, saveLabel }: { copy: IdentityCopy; locale: Locale; initial: IdentityNames; saveLabel: string }) {
  const [value, setValue] = useState<IdentityNames>(initial);
  const errors = validateIdentityNames(normalizeIdentityNames(value));
  const [tried, setTried] = useState(false);
  const bad = Object.keys(errors).length > 0;
  return (
    <>
      <IdentityNamesFields
        copy={copy}
        errors={errors}
        formNames
        inlineNationality
        locale={locale}
        onChange={setValue}
        showErrors={tried}
        value={value}
      />
      {/* 버튼을 span 으로 감싸 폭이 글자만큼 줄고, 한 번 틀리면 회색으로 잠기던 것(2026-10-23 사용자 「저장 버튼이 이상」) —
          다른 칸 시트와 같은 꽉 찬 버튼, 틀리면 잠그지 않고 막은 뒤 칸 아래 오류만 보인다. */}
      <SaveButton
        label={saveLabel}
        onPress={(event) => {
          setTried(true);
          if (bad) event.preventDefault();
        }}
      />
    </>
  );
}

function SaveButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress?: (event: MouseEvent<HTMLButtonElement>) => void }) {
  const { pending } = useFormStatus();
  return (
    <button className="acw-sh__go" disabled={pending || disabled} onClick={onPress} type="submit">
      {pending ? <span aria-hidden="true" className="acw-spin" /> : null}
      {label}
    </button>
  );
}

function Row({ label, value, empty, onClick, href }: { label: string; value?: ReactNode; empty?: boolean; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <span className="acw-row__l">{label}</span>
      {value != null ? (
        <span className="acw-row__v" data-empty={empty ? "" : undefined}>
          {value}
        </span>
      ) : null}
      {onClick || href ? CHEVRON : null}
    </>
  );
  if (href) {
    return (
      <Link className="acw-row" href={href}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button className="acw-row" onClick={onClick} type="button">
        {inner}
      </button>
    );
  }
  return <div className="acw-row">{inner}</div>;
}

export function AccountMobile({ user, organization, bottomTabsLabel, blockedUsers, myReports, help, saved, copy, openIdentity = false, idCard = null }: Props) {
  const w = copy.white;
  const locale = user.language;
  const [editing, setEditing] = useState<Field | null>(openIdentity && !saved ? "name" : null);
  const [board, setBoard] = useState<"blocked" | "reports" | null>(null);
  const [gender, setGender] = useState<Gender | null>(user.gender);
  const [lang, setLang] = useState<Locale>(user.language);
  const [version, setVersion] = useState<string | null>(null);
  const langFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let alive = true;
    void getNativeAppInfo().then((info) => {
      if (!alive) return;
      setVersion(
        info ? w.version.replace("{version}", info.version).replace("{build}", String(info.build)) : w.versionWeb,
      );
    });
    return () => {
      alive = false;
    };
  }, [w.version, w.versionWeb]);

  // 언어 3칸 — 누르는 즉시 저장(서버가 새 언어로 이 화면을 다시 그린다).
  useEffect(() => {
    if (lang !== user.language) langFormRef.current?.requestSubmit();
  }, [lang, user.language]);

  // 하단 탭 편집 — 셸(MobileShell)의 가운데 편집 버튼이 여는 시트를 그대로 연다. 폴드 · 태블릿에선 탭 바가 CSS 로만 숨어 있어
  // 버튼은 그대로 있다.
  function openBottomTabs() {
    document.querySelector<HTMLButtonElement>(".tabbar__fab")?.click();
  }

  const labels: Record<Field, string> = {
    name: copy.name,
    birthDate: copy.birthDate,
    phoneNumber: copy.phone,
    gender: copy.gender,
  };
  const hints: Partial<Record<Field, string>> = {
    birthDate: copy.birthDateHint,
    phoneNumber: copy.phoneHint,
    gender: copy.genderHint,
  };
  const langIndex = Math.max(0, LANGS.indexOf(lang));

  let i = 0;
  const grp = () => ({ "--i": i++ }) as CSSProperties;

  return (
    <div className="acw">
      <div className="acw-me">
        <span aria-hidden="true" className="acw-av">
          {(user.name || "—").slice(0, 1)}
        </span>
        <div style={{ minWidth: 0 }}>
          <b>{user.name || "—"}</b>
          <span>
            {organization.name} · {organization.role}
          </span>
        </div>
      </div>

      {saved ? (
        <p className="acw-msg" data-tone="ok" role="status">
          {copy.saved}
        </p>
      ) : null}
      {copy.errorText ? (
        <p className="acw-msg" data-tone="err" role="alert">
          {copy.errorText}
        </p>
      ) : null}
      {user.identityIncomplete ? (
        <button className="acw-msg acw-msg--btn" onClick={() => setEditing("name")} type="button">
          <b>{copy.identity.fillTitle}</b>
          {copy.identity.fillBody}
        </button>
      ) : null}
      {copy.incomplete ? (
        <p className="acw-msg">
          <b>{copy.incomplete.title}</b>
          {copy.incomplete.body}
        </p>
      ) : null}

      <section className="acw-grp" style={grp()}>
        <span className="acw-sec">{w.secProfile}</span>
        <Row label={copy.name} onClick={() => setEditing("name")} value={user.name || w.notSet} empty={!user.name} />
        <Row
          empty={!user.birthDate}
          label={copy.birthDate}
          onClick={() => setEditing("birthDate")}
          value={user.birthDate ? formatBirth(user.birthDate, locale) : w.notSet}
        />
        <Row
          empty={!user.phoneNumber}
          label={copy.phone}
          onClick={() => setEditing("phoneNumber")}
          value={user.phoneNumber || w.notSet}
        />
        <Row
          empty={!user.gender}
          label={copy.gender}
          onClick={() => {
            setGender(user.gender);
            setEditing("gender");
          }}
          value={user.gender ? copy.genderOptions[user.gender] : w.notSet}
        />
        <div className="acw-row acw-lang">
          <span className="acw-row__l">{copy.language}</span>
          <form action={updateAccountProfile} ref={langFormRef}>
            <HiddenProfile language={lang} user={user} />
            <div aria-label={copy.language} className="acw-seg" role="radiogroup" style={{ "--k": langIndex } as CSSProperties}>
              <span aria-hidden="true" className="acw-seg__thumb" />
              {LANGS.map((code) => (
                <button
                  aria-checked={lang === code}
                  disabled={lang !== user.language}
                  key={code}
                  onClick={() => setLang(code)}
                  role="radio"
                  type="button"
                >
                  {code === "en" ? "EN" : copy.languages[code]}
                </button>
              ))}
            </div>
          </form>
        </div>
      </section>

      <section className="acw-grp" style={grp()}>
        <span className="acw-sec">{w.secOrg}</span>
        <Row label={organization.name} value={organization.role} />
        {idCard ? <Row empty={idCard.missing} href="/account/id-card" label={idCard.label} value={idCard.value} /> : null}
      </section>

      <section className="acw-grp" style={grp()}>
        <span className="acw-sec">{w.secApp}</span>
        <Row label={w.bottomTabs} onClick={openBottomTabs} value={bottomTabsLabel} />
      </section>

      <section className="acw-grp" style={grp()}>
        <span className="acw-sec">{w.secBoard}</span>
        <Row
          label={w.blocked}
          onClick={() => setBoard("blocked")}
          value={w.blockedCount.replace("{n}", String(blockedUsers.length))}
        />
        <Row
          label={w.reports}
          onClick={() => setBoard("reports")}
          value={w.reportsCount.replace("{n}", String(myReports.length))}
        />
      </section>

      <section className="acw-grp" style={grp()}>
        <span className="acw-sec">{w.secHelp}</span>
        {help.map((h) => (
          <Row href={h.href} key={h.href} label={h.label} />
        ))}
      </section>

      <div className="acw-grp" style={grp()}>
        <form action={signOut}>
          <button className="acw-out" type="submit">
            {copy.logout}
          </button>
        </form>
        <div className="acw-del">
          <DeleteAccountSheet copy={copy.deleteSheet} triggerClassName="" />
        </div>
        {version ? <p className="acw-ver">{version}</p> : null}
      </div>

      {editing ? (
        <BottomSheet ariaLabel={labels[editing]} onClose={() => setEditing(null)}>
          {({ close }) => (
            <form action={updateAccountProfile} className="acw-sh">
              <HiddenProfile except={editing} user={user} />
              <div className="acw-sh__h">
                <b>{labels[editing]}</b>
                <span>{w.editHint}</span>
              </div>
              {editing === "name" ? (
                <IdentitySheetFields copy={copy.identity} initial={user.identity} locale={locale} saveLabel={w.save} />
              ) : null}
              {editing === "birthDate" ? (
                <input aria-label={copy.birthDate} defaultValue={user.birthDate ?? ""} name="birthDate" type="date" />
              ) : null}
              {editing === "phoneNumber" ? (
                <input aria-label={copy.phone} autoComplete="tel" defaultValue={user.phoneNumber} inputMode="tel" name="phoneNumber" required type="tel" />
              ) : null}
              {editing === "gender" ? (
                <>
                  <input name="gender" type="hidden" value={gender ?? ""} />
                  <div aria-label={copy.gender} className="acw-sh__g" role="radiogroup">
                    {(["female", "male"] as const).map((g) => (
                      <button aria-checked={gender === g} key={g} onClick={() => setGender(g)} role="radio" type="button">
                        {copy.genderOptions[g]}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
              {hints[editing] ? <span className="acw-sh__hint">{hints[editing]}</span> : null}
              {editing !== "name" ? <SaveButton disabled={editing === "gender" && !gender} label={w.save} /> : null}
              <button className="acw-sh__no" onClick={close} type="button">
                {w.cancel}
              </button>
            </form>
          )}
        </BottomSheet>
      ) : null}

      {board ? (
        <BottomSheet
          ariaLabel={board === "blocked" ? w.blocked : w.reports}
          header={
            <div className="acw-sh__h" style={{ paddingBottom: 6 }}>
              <b>{board === "blocked" ? w.blocked : w.reports}</b>
            </div>
          }
          onClose={() => setBoard(null)}
        >
          <div className="acw-list">
            {board === "blocked" ? (
              <BlockedUsersList bare copy={copy.blockedList} users={blockedUsers} />
            ) : (
              <MyReportsList bare copy={copy.reportsList} reports={myReports} />
            )}
          </div>
        </BottomSheet>
      ) : null}
    </div>
  );
}
