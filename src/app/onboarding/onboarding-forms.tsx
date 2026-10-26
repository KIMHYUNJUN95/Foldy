"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import {
  completeProfile,
  joinOrganizationWithInviteCode,
} from "@/app/onboarding/actions";
import {
  InviteCodeField,
  type InviteCodeFieldCopy,
} from "@/app/onboarding/invite-code-field";
import type { Locale } from "@/lib/i18n";

const GRADIENT = "linear-gradient(165deg, #8a63f0, #5a30cf)";
const SHADOW = "0 18px 36px -20px rgb(122 82 230 / 0.7)";

const inputClass =
  "h-[54px] w-full rounded-[14px] border border-border bg-surface px-[15px] text-base font-semibold text-foreground outline-none transition-colors placeholder:font-medium placeholder:text-text-done focus:border-primary focus:ring-[3.5px] focus:ring-primary/15";

function SubmitButton({ label, disabled }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  const off = pending || disabled;
  return (
    <button
      type="submit"
      disabled={off}
      className={`relative flex h-[54px] w-full items-center justify-center rounded-[15px] text-[15.5px] font-extrabold tracking-[-0.01em] text-white ${off ? "pointer-events-none opacity-80" : ""}`}
      style={{ background: GRADIENT, boxShadow: off ? "none" : SHADOW }}
    >
      {pending ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="size-4 animate-spin rounded-full border-[2.4px] border-white/60 border-t-white" />
        </span>
      ) : label}
    </button>
  );
}

export type ProfileFormCopy = {
  nameLabel: string;
  namePlaceholder: string;
  birthDateLabel: string;
  birthDatePlaceholder: string;
  birthDateHint: string;
  genderLabel: string;
  genderPlaceholder: string;
  genderOptions: Record<string, string>;
  phoneLabel: string;
  phonePlaceholder: string;
  phoneHint: string;
  languageLabel: string;
  languages: { ko: string; ja: string; en: string };
  continueCta: string;
  joinTeamCta: string;
  invite: InviteCodeFieldCopy;
};

/**
 * needs_profile 단계 — 필수 운영 프로필(이름, 생년
 * 월일, 전화번호, 언어)과 선택 사항인 초대 코드를 받는다. 미리보기 흐름에서 코드가
 * 확인되면 CTA 가 "이 팀에 합류"로 바뀌고 `completeProfile` 이
 * 프로필 저장과 합류를 한 번에 처리한다. 코드가 없으면 사용자는
 * 멤버십 단계로 이동한다.
 */
export function ProfileForm({
  copy,
  locale,
  safeNext,
  defaultName = "",
  defaultBirthDate = "",
  defaultGender = "",
  defaultPhone = "",
}: {
  copy: ProfileFormCopy;
  locale: Locale;
  safeNext: string;
  defaultName?: string;
  defaultBirthDate?: string;
  defaultGender?: string;
  defaultPhone?: string;
}) {
  const [verifiedCode, setVerifiedCode] = useState<string | null>(null);

  return (
    <form action={completeProfile} className="mt-6 grid gap-4">
      {safeNext && <input name="next" type="hidden" value={safeNext} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-bold text-foreground">{copy.nameLabel}</span>
          <input
            className={inputClass}
            name="name"
            placeholder={copy.namePlaceholder}
            defaultValue={defaultName}
            required
            type="text"
            autoComplete="name"
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-bold text-foreground">{copy.birthDateLabel}</span>
          <input
            className={inputClass}
            name="birthDate"
            placeholder={copy.birthDatePlaceholder}
            defaultValue={defaultBirthDate}
            required
            type="date"
          />
          <span className="block text-[13px] font-medium leading-5 text-muted-foreground">
            {copy.birthDateHint}
          </span>
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-bold text-foreground">{copy.genderLabel}</span>
          <select
            className={`${inputClass} w-full`}
            defaultValue={defaultGender}
            name="gender"
            required
          >
            <option value="">{copy.genderPlaceholder}</option>
            {Object.entries(copy.genderOptions).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-bold text-foreground">{copy.phoneLabel}</span>
          <input
            className={inputClass}
            name="phoneNumber"
            placeholder={copy.phonePlaceholder}
            defaultValue={defaultPhone}
            required
            type="tel"
            autoComplete="tel"
          />
          <span className="block text-[13px] font-medium leading-5 text-muted-foreground">
            {copy.phoneHint}
          </span>
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-bold text-foreground">{copy.languageLabel}</span>
          <select
            className={`${inputClass} w-full`}
            defaultValue={locale}
            name="preferredLanguage"
          >
            <option value="ko">{copy.languages.ko}</option>
            <option value="ja">{copy.languages.ja}</option>
            <option value="en">{copy.languages.en}</option>
          </select>
        </label>
      </div>

      <InviteCodeField copy={copy.invite} onVerifiedChange={setVerifiedCode} />
      {verifiedCode && <input name="inviteCode" type="hidden" value={verifiedCode} />}

      <SubmitButton label={verifiedCode ? copy.joinTeamCta : copy.continueCta} />
    </form>
  );
}

export type JoinFormCopy = {
  joinTeamCta: string;
  invite: InviteCodeFieldCopy;
};

/**
 * needs_membership 단계 — 프로필은 이미 완료되어 있고, 사용자는 조직에
 * 합류하기만 하면 된다. 합류 버튼은 초대 코드가 미리보기 흐름으로
 * 확인되기 전까지 비활성이다.
 */
export function JoinForm({
  copy,
  safeNext,
}: {
  copy: JoinFormCopy;
  safeNext: string;
}) {
  const [verifiedCode, setVerifiedCode] = useState<string | null>(null);

  return (
    <form action={joinOrganizationWithInviteCode} className="mt-6 space-y-4">
      {safeNext && <input name="next" type="hidden" value={safeNext} />}
      <InviteCodeField copy={copy.invite} onVerifiedChange={setVerifiedCode} />
      {verifiedCode && <input name="inviteCode" type="hidden" value={verifiedCode} />}
      <SubmitButton label={copy.joinTeamCta} disabled={!verifiedCode} />
    </form>
  );
}
