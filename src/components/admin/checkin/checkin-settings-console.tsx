"use client";

// 셀프 체크인 · 건물 설정(시안 S8) — 언어 · 환영 문구 · 약관 · 본인 확인(동영상 초) · 연락처 · 직원 PIN. 건물을 고르고 아래 「저장」 한 번.
// 권한 `checkin.manage`. PIN 은 읽어 오지 않는다(「설정됨」만) — 입력값도 화면에 다시 보여 주지 않는다. 서버의 invalid.field 는 그 구역 옆에 보인다.
// 칸 설정 · 대기 시간 · MRZ 자동 입력은 이 화면에서 고치지 않고 지금 값을 그대로 보낸다(칸 추가는 P1). docs/product/44 FR-S08
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveCheckinPropertySettings, type GetCheckinPropertySettingsResult } from "@/actions/checkin/settings";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { useBuildingName } from "@/components/shared/building-names";
import { haptic } from "@/lib/haptics";
import { CHECKIN_CONTACT_KEYS, CHECKIN_LANGUAGES, type CheckinContactKey, type CheckinLanguage, type CheckinPropertySettings, type CheckinSettingsInvalidField } from "@/lib/checkin/settings-model";
import {
  countSettingsChanges,
  formatTokyoStamp,
  isValidPinInput,
  sectionOfInvalidField,
  toSaveInput,
  toSettingsForm,
  type PinPlan,
  type SettingsForm,
  type SettingsSection,
} from "@/lib/checkin/staff-view";
import { fill, type CheckinCopy, type CheckinSharedCopy } from "./checkin-copy";
import { CheckinState } from "./checkin-ui";
import "./checkin.css";

export function CheckinSettingsConsole({
  copy,
  shared,
  properties,
  propertyKey,
  result,
}: {
  copy: CheckinCopy;
  shared: CheckinSharedCopy;
  properties: { key: string; name: string }[];
  propertyKey: string;
  result: GetCheckinPropertySettingsResult;
}) {
  const router = useRouter();
  const buildingName = useBuildingName();
  const [pending, startTransition] = useTransition();

  const picker = (
    <div className="ck-bar">
      <AdmDropdown
        size="sm"
        value={propertyKey}
        onChange={(value) => startTransition(() => router.replace(`/admin/checkin/settings?property=${encodeURIComponent(value)}`))}
        ariaLabel={copy.propertyLabel}
        options={properties.map((property) => ({ value: property.key, label: buildingName(property.name) }))}
      />
    </div>
  );

  if (!result.ok) {
    const kind = result.errorKey === "forbidden" ? "forbidden" : result.errorKey === "not_ready" ? "notReady" : "error";
    return (
      <div className="ck">
        {picker}
        <CheckinState
          kind={kind}
          title={kind === "forbidden" ? shared.noAccessTitle : kind === "notReady" ? copy.notReadyTitle : copy.errorTitle}
          body={kind === "forbidden" ? shared.noAccessBody : kind === "notReady" ? copy.notReadyBody : copy.errorBody}
          action={
            kind === "error" ? (
              <button type="button" className="ck-btn is-sm" onClick={() => startTransition(() => router.refresh())}>
                {copy.retry}
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className={`ck${pending ? " ck-busy" : ""}`}>
      {picker}
      <SettingsEditor key={result.settings.propertyKey} initial={result.settings} copy={copy} />
    </div>
  );
}

type Invalid = { field: CheckinSettingsInvalidField; section: SettingsSection } | null;

function langName(language: CheckinLanguage, copy: CheckinCopy): string {
  return language === "ja" ? copy.langJa : language === "en" ? copy.langEn : language === "zh-Hans" ? copy.langZh : copy.langKo;
}

function contactLabel(key: CheckinContactKey, copy: CheckinCopy): string {
  return key === "phone" ? copy.contactPhone : key === "line" ? copy.contactLine : copy.contactWhatsapp;
}

function invalidMessage(field: CheckinSettingsInvalidField, copy: CheckinCopy): string {
  switch (field) {
    case "languages":
      return copy.invLanguages;
    case "welcomeText":
      return copy.invWelcome;
    case "termsText":
      return copy.invTerms;
    case "videoSecondsPerGuest":
      return copy.invVideo;
    case "supportContacts":
      return copy.invContacts;
    case "staffPin":
      return copy.invPin;
    default:
      return copy.invOther;
  }
}

function SettingsEditor({ initial, copy }: { initial: CheckinPropertySettings; copy: CheckinCopy }) {
  const { toast, showToast, dismiss } = useAdminToast();
  const [saved, setSaved] = useState(initial);
  const [baseline, setBaseline] = useState(() => toSettingsForm(initial));
  const [form, setForm] = useState<SettingsForm>(baseline);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<Invalid>(null);
  const [welcomeLang, setWelcomeLang] = useState<CheckinLanguage>("ja");
  const [termsLang, setTermsLang] = useState<CheckinLanguage>("ja");
  const [pinDraft, setPinDraft] = useState("");

  const changes = countSettingsChanges(baseline, form);
  const dirty = changes > 0;
  const enabledLanguages = CHECKIN_LANGUAGES.filter((language) => form.languages.includes(language));
  const textLanguages = enabledLanguages.length > 0 ? enabledLanguages : [...CHECKIN_LANGUAGES];
  const activeWelcome = textLanguages.includes(welcomeLang) ? welcomeLang : textLanguages[0];
  const activeTerms = textLanguages.includes(termsLang) ? termsLang : textLanguages[0];

  function update(patch: Partial<SettingsForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setInvalid(null);
  }

  function setPin(plan: PinPlan) {
    update({ pin: plan });
  }

  function revert() {
    setForm(baseline);
    setPinDraft("");
    setInvalid(null);
  }

  async function save() {
    if (busy || !dirty) return;
    const seconds = Number(form.videoSecondsPerGuest);
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) {
      setInvalid({ field: "videoSecondsPerGuest", section: "verify" });
      return;
    }
    if (form.pin.mode === "set" && !isValidPinInput(form.pin.value)) {
      setInvalid({ field: "staffPin", section: "pin" });
      return;
    }
    setBusy(true);
    try {
      const result = await saveCheckinPropertySettings(toSaveInput(saved, form));
      if (result.ok) {
        haptic("success");
        const next = toSettingsForm(result.settings);
        setSaved(result.settings);
        setBaseline(next);
        setForm(next);
        setPinDraft("");
        setInvalid(null);
        showToast(copy.settingsSaved);
      } else if (result.errorKey === "invalid" && "field" in result) {
        haptic("error");
        setInvalid({ field: result.field, section: sectionOfInvalidField(result.field) });
      } else {
        haptic("error");
        showToast(result.errorKey === "conflict" ? copy.settingsConflict : copy.settingsSaveFailed);
      }
    } catch {
      showToast(copy.settingsSaveFailed);
    } finally {
      setBusy(false);
    }
  }

  const err = (section: SettingsSection) => (invalid?.section === section ? <p className="ck-err" role="alert">{invalidMessage(invalid.field, copy)}</p> : null);
  const bad = (section: SettingsSection) => invalid?.section === section || undefined;

  return (
    <>
      <p className="ck-soft">
        {saved.saved && saved.updatedAt
          ? saved.updatedByName
            ? fill(copy.settingsLastSaved, { at: formatTokyoStamp(saved.updatedAt), name: saved.updatedByName })
            : fill(copy.settingsLastSavedNoName, { at: formatTokyoStamp(saved.updatedAt) })
          : copy.settingsNeverSaved}
      </p>

      <div>
        <section className="ck-set" aria-labelledby="ck-s-lang">
          <div>
            <h3 id="ck-s-lang">{copy.secLanguages}</h3>
            <p className="ck-set__d">{copy.secLanguagesBody}</p>
          </div>
          <div className="ck-set__b">
            <div className="ck-checks" role="group" aria-label={copy.secLanguages}>
              {CHECKIN_LANGUAGES.map((language) => {
                const on = form.languages.includes(language);
                return (
                  <button
                    key={language}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={`ck-check${on ? " on" : ""}`}
                    onClick={() => update({ languages: on ? form.languages.filter((item) => item !== language) : [...form.languages, language] })}
                  >
                    <i aria-hidden="true">
                      <Check />
                    </i>
                    {langName(language, copy)}
                  </button>
                );
              })}
            </div>
            {err("languages")}
          </div>
        </section>

        <section className="ck-set" aria-labelledby="ck-s-welcome">
          <div>
            <h3 id="ck-s-welcome">{copy.secWelcome}</h3>
            <p className="ck-set__d">{copy.secWelcomeBody}</p>
          </div>
          <div className="ck-set__b">
            <LangTabs languages={textLanguages} active={activeWelcome} onChange={setWelcomeLang} copy={copy} />
            <input
              className="ck-in"
              aria-label={`${copy.secWelcome} · ${langName(activeWelcome, copy)}`}
              aria-invalid={bad("welcome")}
              value={form.welcomeText[activeWelcome]}
              onChange={(event) => update({ welcomeText: { ...form.welcomeText, [activeWelcome]: event.target.value } })}
            />
            {err("welcome")}
          </div>
        </section>

        <section className="ck-set" aria-labelledby="ck-s-terms">
          <div>
            <h3 id="ck-s-terms">{copy.secTerms}</h3>
            <p className="ck-set__d">{copy.secTermsBody}</p>
          </div>
          <div className="ck-set__b">
            <p className="ck-soft num">{fill(copy.termsVersion, { n: saved.termsVersion })}</p>
            <LangTabs languages={textLanguages} active={activeTerms} onChange={setTermsLang} copy={copy} />
            <textarea
              className="ck-in"
              aria-label={`${copy.secTerms} · ${langName(activeTerms, copy)}`}
              aria-invalid={bad("terms")}
              rows={7}
              value={form.termsText[activeTerms]}
              onChange={(event) => update({ termsText: { ...form.termsText, [activeTerms]: event.target.value } })}
            />
            {err("terms")}
          </div>
        </section>

        <section className="ck-set" aria-labelledby="ck-s-verify">
          <div>
            <h3 id="ck-s-verify">{copy.secVerify}</h3>
            <p className="ck-set__d">{copy.secVerifyBody}</p>
          </div>
          <div className="ck-set__b">
            <div className="ck-set__row">
              <b>{copy.verifyVideo}</b>
              <span className="ck-soft">{copy.verifyPerGuest}</span>
              <input
                className="ck-in is-short num"
                inputMode="numeric"
                aria-label={`${copy.verifyVideo} · ${copy.secondsUnit}`}
                aria-invalid={bad("verify")}
                value={form.videoSecondsPerGuest}
                onChange={(event) => update({ videoSecondsPerGuest: event.target.value.replace(/[^0-9]/g, "").slice(0, 2) })}
              />
              <span className="ck-soft">{copy.secondsUnit}</span>
            </div>
            {err("verify")}
          </div>
        </section>

        <section className="ck-set" aria-labelledby="ck-s-contacts">
          <div>
            <h3 id="ck-s-contacts">{copy.secContacts}</h3>
            <p className="ck-set__d">{copy.secContactsBody}</p>
          </div>
          <div className="ck-set__b">
            <div className="ck-contacts">
              {CHECKIN_CONTACT_KEYS.map((key) => (
                <div className="ck-field" key={key}>
                  <label htmlFor={`ck-contact-${key}`}>{contactLabel(key, copy)}</label>
                  <input
                    id={`ck-contact-${key}`}
                    className="ck-in num"
                    aria-invalid={bad("contacts")}
                    value={form.supportContacts[key]}
                    onChange={(event) => update({ supportContacts: { ...form.supportContacts, [key]: event.target.value } })}
                  />
                </div>
              ))}
            </div>
            {err("contacts")}
          </div>
        </section>

        <section className="ck-set" aria-labelledby="ck-s-pin">
          <div>
            <h3 id="ck-s-pin">{copy.secPin}</h3>
            <p className="ck-set__d">{copy.secPinBody}</p>
          </div>
          <div className="ck-set__b">
            {form.pin.mode === "set" ? (
              <div className="ck-set__row">
                <input
                  className="ck-in num"
                  style={{ maxWidth: 220 }}
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  aria-label={copy.secPin}
                  aria-invalid={bad("pin")}
                  placeholder={copy.pinPlaceholder}
                  maxLength={8}
                  value={pinDraft}
                  onChange={(event) => {
                    const value = event.target.value.replace(/[^0-9]/g, "").slice(0, 8);
                    setPinDraft(value);
                    setPin({ mode: "set", value });
                  }}
                />
                <button
                  type="button"
                  className="ck-btn is-sm"
                  onClick={() => {
                    setPinDraft("");
                    setPin({ mode: "keep" });
                  }}
                >
                  {copy.pinCancel}
                </button>
              </div>
            ) : (
              <div className="ck-set__row">
                <b className={form.pin.mode === "clear" || !saved.hasStaffPin ? "ck-soft" : undefined}>
                  {form.pin.mode === "clear" ? copy.pinNotSet : saved.hasStaffPin ? copy.pinIsSet : copy.pinNotSet}
                </b>
                {form.pin.mode === "clear" ? (
                  <>
                    <span className="ck-soft">{copy.pinWillClear}</span>
                    <button type="button" className="ck-btn is-sm" onClick={() => setPin({ mode: "keep" })}>
                      {copy.pinCancel}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="ck-btn is-sm" onClick={() => setPin({ mode: "set", value: "" })}>
                      {saved.hasStaffPin ? copy.pinChange : copy.pinSetNew}
                    </button>
                    {saved.hasStaffPin ? (
                      <button type="button" className="ck-btn is-sm" onClick={() => setPin({ mode: "clear" })}>
                        {copy.pinClear}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            )}
            {err("pin")}
            {err("other")}
          </div>
        </section>
      </div>

      <div className="ck-foot">
        <span className="ck-soft num">{dirty ? fill(copy.settingsChanged, { n: changes }) : ""}</span>
        <span className="ck-sp" />
        <button type="button" className="ck-btn" onClick={revert} disabled={!dirty || busy}>
          {copy.settingsRevert}
        </button>
        <button type="button" className="ck-btn is-pri" onClick={() => void save()} disabled={!dirty || busy} aria-busy={busy}>
          {copy.save}
        </button>
      </div>
      {toast ? <AdminToast key={toast.id} message={toast.message} onDismiss={dismiss} /> : null}
    </>
  );
}

function LangTabs({ languages, active, onChange, copy }: { languages: readonly CheckinLanguage[]; active: CheckinLanguage; onChange: (language: CheckinLanguage) => void; copy: CheckinCopy }) {
  return (
    <div className="ck-seg" role="tablist">
      {languages.map((language) => (
        <button key={language} type="button" role="tab" aria-selected={language === active} className={language === active ? "on" : undefined} onClick={() => onChange(language)}>
          {langName(language, copy)}
        </button>
      ))}
    </div>
  );
}
