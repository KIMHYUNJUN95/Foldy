"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { fmt, type Dictionary, type Locale } from "@/lib/i18n";

import { BirthDateField } from "./birth-date-field";
import { BackIcon, CameraIcon, CheckIcon } from "./icons";
import { LangSwitch } from "./lang-switch";
import { SeatRemover } from "./seat-remover";

// 한 사람 명부(시안 W3). 웹은 여권을 판독하지 않는다 — 사진을 보며 손으로 넣는다(16 §6).
// 동행자의 주소 · 숙박지는 대표자 값을 그대로 저장하고(「바꾸기」로 따로), 서버가 다시 검사한다.

export type PersonInitial = {
  id?: string;
  lastName: string;
  firstName: string;
  nameKana: string;
  guestType: "adult" | "child";
  hasJapanAddress: boolean;
  nationality: string;
  passportNumber: string;
  birthDate: string;
  gender: "male" | "female" | null;
  noPassport: boolean;
  address: string;
  prevStay: string;
  nextDest: string;
};

type Props = {
  token: string;
  locale: Locale;
  dict: Pick<Dictionary, "person" | "common" | "guests">;
  title: string;
  counter: string;
  initial: PersonInitial;
  isRepresentative: boolean;
  representativeName: string;
  sharedFromRep: { address: string; prevStay: string; nextDest: string } | null;
  photoUrl: string | null;
  countries: { code: string; name: string }[];
  editable: boolean;
  nextHref: string;
  listHref: string;
  canRemove: boolean;
};

const MAX_EDGE = 2400;

// 긴 변 2,400px JPEG 로 줄인다(16 §6) — 폰 사진(5~12MB)도 서버 한도 안에 든다. 방향(EXIF)은 브라우저가 맞춘다.
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/jpeg", 0.85),
  );
}

type FieldError = "lastName" | "firstName" | "nationality" | "passportNumber" | "birthDate";

export function PersonForm(props: Props) {
  const { token, locale, dict, initial, isRepresentative, sharedFromRep, editable } = props;
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [ownShared, setOwnShared] = useState(
    !sharedFromRep ||
      (!!initial.id &&
        (initial.address !== sharedFromRep.address ||
          initial.prevStay !== sharedFromRep.prevStay ||
          initial.nextDest !== sharedFromRep.nextDest)),
  );
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<FieldError[]>([]);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.preview);
  }, [photo]);

  const foreign = !form.hasJapanAddress;
  const passportExempt = form.guestType === "child" && form.noPassport;
  const showPassport = foreign && !passportExempt;
  const photoShown = photo?.preview ?? props.photoUrl;
  const disabled = !editable || pending;

  const set = <K extends keyof PersonInitial>(key: K, value: PersonInitial[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage(dict.person.photoError);
      return;
    }
    try {
      const blob = await shrinkImage(file);
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
      setMessage(null);
    } catch {
      setMessage(dict.person.photoError);
    }
  }

  function save() {
    const shared = ownShared || !sharedFromRep ? form : { ...form, ...sharedFromRep };
    const missing: FieldError[] = [];
    if (!shared.lastName.trim()) missing.push("lastName");
    if (!shared.firstName.trim()) missing.push("firstName");
    if (showPassport && shared.passportNumber && !/^[A-Za-z0-9\s-]{5,14}$/.test(shared.passportNumber)) {
      missing.push("passportNumber");
    }
    setInvalid(missing);
    if (missing.length) {
      setMessage(dict.person.invalid);
      return;
    }
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/guest/${token}/guests`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(shared.id ? { id: shared.id } : {}),
            lastName: shared.lastName,
            firstName: shared.firstName,
            nameKana: shared.nameKana || undefined,
            guestType: shared.guestType,
            hasJapanAddress: shared.hasJapanAddress,
            nationality: foreign ? shared.nationality || undefined : undefined,
            passportNumber: showPassport ? shared.passportNumber || undefined : undefined,
            birthDate: shared.birthDate || undefined,
            gender: shared.gender ?? undefined,
            noPassport: shared.guestType === "child" && shared.noPassport,
            address: shared.address || undefined,
            prevStay: foreign ? shared.prevStay || undefined : undefined,
            nextDest: foreign ? shared.nextDest || undefined : undefined,
          }),
        });
        const body = (await response.json()) as { ok: boolean; guest_id?: string; error?: string; fields?: string[] };
        if (!body.ok || !body.guest_id) {
          if (body.error === "invalid") {
            const map: Record<string, FieldError> = {
              nationality: "nationality",
              passportNumber: "passportNumber",
              birthDate: "birthDate",
              lastName: "lastName",
              firstName: "firstName",
            };
            setInvalid((body.fields ?? []).map((field) => map[field]).filter(Boolean));
            setMessage(dict.person.invalid);
          } else {
            setMessage(body.error === "locked" ? dict.person.locked : dict.common.error);
          }
          return;
        }
        set("id", body.guest_id);

        if (photo && showPassport) {
          const data = new FormData();
          data.set("guest_id", body.guest_id);
          data.set("file", photo.blob, "passport.jpg");
          const upload = await fetch(`/api/guest/${token}/passport`, { method: "POST", body: data });
          const uploadBody = (await upload.json()) as { ok: boolean };
          if (!uploadBody.ok) {
            setMessage(dict.person.photoError);
            router.replace(`/r/${token}/guest/${body.guest_id}`);
            return;
          }
        }
        router.push(props.nextHref);
        router.refresh();
      } catch {
        setMessage(dict.common.error);
      }
    });
  }

  const err = (field: FieldError) => (invalid.includes(field) ? { "aria-invalid": true as const } : {});

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-4">
      <div className="flex h-11 items-center justify-between">
        <Link href={props.listHref} className="w-icon" aria-label={dict.common.back}>
          <BackIcon />
        </Link>
        <LangSwitch locale={locale} label={dict.common.language} />
      </div>
      <p className="num mt-6 text-[14px] text-[var(--muted)]">{props.counter}</p>
      <h1 className="w-h mt-1 text-[30px]">{props.title}</h1>

      <form
        className="mt-6 flex flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <fieldset disabled={disabled} className="flex flex-col gap-5">
          <label className="w-check">
            <input
              type="checkbox"
              checked={form.hasJapanAddress}
              onChange={(event) => set("hasJapanAddress", event.target.checked)}
            />
            <span className="text-[16px]">{dict.person.japanAddress}</span>
          </label>

          {showPassport ? (
            <div>
              <span className="w-lab">{dict.person.photo}</span>
              {photoShown ? (
                <div className="relative overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface)]">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 서명 URL · 로컬 미리보기라 최적화 대상 아님 */}
                  <img src={photoShown} alt={dict.person.photo} className="max-h-64 w-full object-contain" />
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="absolute right-2 top-2 h-10 rounded-md bg-[var(--bg)]/85 px-3 text-[14px]"
                  >
                    {dict.person.retake}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="flex h-28 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[var(--line-strong)] text-[15px]"
                >
                  <CameraIcon />
                  {dict.person.takePhoto}
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                aria-hidden
                tabIndex={-1}
                onChange={(event) => {
                  void pickPhoto(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <p className="mt-2 text-[15px] text-[var(--muted)]">
                {photo ? (
                  <span className="inline-flex items-center gap-1 text-[var(--sage)]">
                    <CheckIcon /> {dict.person.photoAdded}
                  </span>
                ) : (
                  dict.person.photoHelp
                )}
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="w-lab">{dict.person.lastName}</span>
              <input
                className="w-in uppercase"
                autoComplete="off"
                value={form.lastName}
                onChange={(event) => set("lastName", event.target.value)}
                {...err("lastName")}
              />
            </label>
            <label>
              <span className="w-lab">{dict.person.firstName}</span>
              <input
                className="w-in uppercase"
                autoComplete="off"
                value={form.firstName}
                onChange={(event) => set("firstName", event.target.value)}
                {...err("firstName")}
              />
            </label>
          </div>

          {form.hasJapanAddress ? (
            <label>
              <span className="w-lab">{dict.person.nameKana}</span>
              <input className="w-in" value={form.nameKana} onChange={(event) => set("nameKana", event.target.value)} />
            </label>
          ) : (
            <label>
              <span className="w-lab">{dict.person.nationality}</span>
              <select
                className="w-in"
                value={form.nationality}
                onChange={(event) => set("nationality", event.target.value)}
                {...err("nationality")}
              >
                <option value="">{dict.person.nationalityPick}</option>
                {props.countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showPassport ? (
            <label>
              <span className="w-lab">{dict.person.passportNumber}</span>
              <input
                className="w-in num uppercase"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={form.passportNumber}
                onChange={(event) => set("passportNumber", event.target.value)}
                {...err("passportNumber")}
              />
            </label>
          ) : null}

          {foreign ? (
            <>
              <label>
                <span className="w-lab">{dict.person.birthDate}</span>
                <BirthDateField
                  locale={locale}
                  value={form.birthDate}
                  onChange={(iso) => set("birthDate", iso)}
                  labels={{ year: dict.person.year, month: dict.person.month, day: dict.person.day }}
                  invalid={invalid.includes("birthDate")}
                />
              </label>
              <div>
                <span className="w-lab">{dict.person.gender}</span>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={dict.person.gender}>
                  {(["male", "female"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={form.gender === value}
                      onClick={() => set("gender", value)}
                      className={`h-14 rounded-md border text-[17px] ${
                        form.gender === value
                          ? "border-[var(--text)] bg-[var(--text)] font-medium text-[var(--ink)]"
                          : "border-[var(--line)]"
                      }`}
                    >
                      {value === "male" ? dict.person.male : dict.person.female}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {!isRepresentative ? (
            <div className="flex flex-col gap-2">
              <label className="w-check">
                <input
                  type="checkbox"
                  checked={form.guestType === "child"}
                  onChange={(event) => set("guestType", event.target.checked ? "child" : "adult")}
                />
                <span className="text-[16px]">{dict.person.child}</span>
              </label>
              {form.guestType === "child" && foreign ? (
                <label className="w-check">
                  <input type="checkbox" checked={form.noPassport} onChange={(event) => set("noPassport", event.target.checked)} />
                  <span className="text-[16px]">{dict.person.noPassport}</span>
                </label>
              ) : null}
            </div>
          ) : null}

          {sharedFromRep && !ownShared ? (
            <div className="flex items-start justify-between gap-3 rounded-md bg-[var(--surface)] p-4">
              <div>
                <p className="text-[15px]">{fmt(dict.person.sameAsRep, { name: props.representativeName })}</p>
                <p className="mt-1 text-[15px] text-[var(--muted)]">
                  {[sharedFromRep.address, foreign ? sharedFromRep.prevStay : "", foreign ? sharedFromRep.nextDest : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                className="h-10 shrink-0 rounded-md border border-[var(--line-strong)] px-3 text-[14px]"
                onClick={() => setOwnShared(true)}
              >
                {dict.person.change}
              </button>
            </div>
          ) : (
            <>
              <label>
                <span className="w-lab">{dict.person.address}</span>
                <input
                  className="w-in"
                  autoComplete="street-address"
                  placeholder={foreign ? dict.person.addressHelp : undefined}
                  value={form.address}
                  onChange={(event) => set("address", event.target.value)}
                />
              </label>
              {foreign ? (
                <>
                  <label>
                    <span className="w-lab">{dict.person.prevStay}</span>
                    <input className="w-in" value={form.prevStay} onChange={(event) => set("prevStay", event.target.value)} />
                  </label>
                  <label>
                    <span className="w-lab">{dict.person.nextDest}</span>
                    <input className="w-in" value={form.nextDest} onChange={(event) => set("nextDest", event.target.value)} />
                  </label>
                </>
              ) : null}
            </>
          )}
        </fieldset>

        <p className="mt-6 text-[15px] text-[var(--muted)]">{dict.person.retention}</p>
        <div className="flex-1" />
        {!editable ? (
          <p className="mt-6 text-[14px] text-[var(--sand)]">{dict.person.locked}</p>
        ) : (
          <>
            {message ? (
              <p role="alert" className="mt-6 text-[14px] text-[var(--error)]">
                {message}
              </p>
            ) : null}
            <button type="submit" className="w-btn mt-4" disabled={pending}>
              {pending ? dict.person.saving : dict.person.saveNext}
            </button>
            {props.canRemove && !isRepresentative ? (
              <div className="mt-5 flex justify-center">
                <SeatRemover
                  token={token}
                  guestId={initial.id ?? null}
                  label={dict.person.notComing}
                  confirm={dict.person.notComingConfirm}
                  remove={dict.common.remove}
                  cancel={dict.common.cancel}
                  error={dict.common.error}
                  afterHref={props.listHref}
                />
              </div>
            ) : null}
          </>
        )}
      </form>
    </main>
  );
}
