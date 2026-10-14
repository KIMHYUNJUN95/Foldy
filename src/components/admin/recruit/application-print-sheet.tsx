"use client";

import type { Dictionary } from "@/lib/i18n";
import type { ApplicationDetail } from "@/lib/recruit/applications";

/**
 * 지원서 인쇄 — A4 한 장.
 *
 * 예전 채용 사이트 관리자 포털에 있던 기능을 Foldy 로 되살린 것이다(2026-09-24). 면접장에
 * 종이 지원서를 들고 들어가는 업무가 실제로 있고, 화면을 그대로 인쇄하면 패널 스크롤·버튼·
 * 사이드바가 섞여 나온다.
 *
 * **연락처를 넣는다(2026-09-24 사용자 결정).** Excel·PDF 내보내기는 전화·카카오·주소를 빼지만
 * (`docs/product/30-recruit-workflow.md` → 내보내기), 인쇄는 예외다 — 종이 지원서를 대체하는
 * 용도라 면접장에서 본인 확인·연락에 바로 쓰인다. 파일은 한번 전달되면 회수할 수 없지만
 * 인쇄물은 손에서 손으로만 움직인다.
 *
 * 구현은 `休暇届`(`leave-documents-view.tsx`)와 같은 방식이다: 화면에서는 숨어 있는 A4 시트를
 * 하나 렌더해 두고, `@media print` 가 그것만 남기고 나머지를 전부 감춘다(`recruit-console.css`).
 * 새 라우트를 만들지 않으므로 「인쇄」를 눌렀을 때 패널이 닫히거나 상태를 잃지 않는다.
 *
 * 라벨은 **패널이 쓰는 `copy.*` 를 그대로 재사용**한다. 인쇄물에만 쓰는 문구를 따로 만들면
 * 화면과 종이의 용어가 갈라진다(ko/ja/en 은 사전이 이미 보장한다).
 */

type Props = {
  application: ApplicationDetail;
  copy: Dictionary["recruit"];
};

/** 값이 없는 칸은 지우지 않고 「—」로 남긴다 — 종이에서 칸이 비면 「안 물어봤다」와 구분이 안 된다. */
function val(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : "—";
}

function Field({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rcps__f${wide ? " rcps__f--wide" : ""}`}>
      <span className="rcps__k">{label}</span>
      <span className="rcps__v">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rcps__sec">
      <h2 className="rcps__st">{title}</h2>
      <div className="rcps__grid">{children}</div>
    </section>
  );
}

export function ApplicationPrintSheet({ application, copy }: Props) {
  // 출력일은 인쇄 시점이 아니라 렌더 시점이다. 초 단위 정확도가 필요한 값이 아니고, 인쇄
  // 다이얼로그를 여는 순간 DOM 을 건드리면 브라우저마다 반영 시점이 갈린다.
  const printedOn = new Date().toISOString().slice(0, 10);
  const workDays = application.workDays.length > 0 ? application.workDays.join(" · ") : "—";
  const experience = application.hasIndustryExp ? copy.labelExperienceYes : copy.labelExperienceNo;
  const tasks = application.industryTasks.length > 0 ? application.industryTasks.join(" · ") : null;

  return (
    <div id="rcSheet" className="rcps" aria-hidden="true">
      <header className="rcps__h">
        <div className="rcps__ht">
          <h1 className="rcps__title">{copy.printTitle}</h1>
          <p className="rcps__name">{application.name}</p>
        </div>
        <dl className="rcps__meta">
          <div>
            <dt>{copy.printAppliedAt}</dt>
            <dd>{val(application.appliedAt?.slice(0, 10))}</dd>
          </div>
          {/* 검토 단계는 인쇄물에 넣지 않는다(2026-09-24) — 종이는 지원자 정보를 보는 물건이고,
              심사 진행 상황은 콘솔에서 바뀌므로 인쇄된 순간 이미 낡은 값이다. */}
          <div>
            <dt>{copy.printedAt}</dt>
            <dd>{printedOn}</dd>
          </div>
        </dl>
      </header>

      <Section title={copy.sectionBasic}>
        <Field label={copy.colName} value={val(application.name)} />
        <Field label={copy.colAge} value={val(application.age)} />
        <Field label={copy.labelGender} value={val(application.gender)} />
        <Field label={copy.labelNationality} value={val(application.nationality)} />
        <Field label={copy.labelPhone} value={val(application.phone)} />
        <Field label={copy.labelKakao} value={val(application.kakaoId)} />
        <Field label={copy.labelAddress} value={val(application.address)} wide />
      </Section>

      <Section title={copy.printSectionJob}>
        <Field label={copy.colJob} value={val(application.jobTitle)} />
        <Field label={copy.colEmployment} value={val(application.employmentType)} />
        <Field label={copy.labelAppliedPosition} value={val(application.appliedPosition)} />
        <Field label={copy.labelSource} value={val(application.sourceChannel)} />
      </Section>

      <Section title={copy.sectionWork}>
        <Field label={copy.labelWorkDays} value={workDays} wide />
        <Field label={copy.labelDaysPerWeek} value={val(application.daysPerWeek)} />
        <Field label={copy.labelDuration} value={val(application.duration)} />
        <Field label={copy.labelStart} value={val(application.startDate)} />
        <Field label={copy.labelCommute} value={val(application.commuteTime)} />
        <Field label={copy.labelUniform} value={val(application.uniformSize)} />
      </Section>

      <Section title={copy.sectionVisa}>
        <Field label={copy.labelVisaType} value={val(application.visaType)} />
        <Field label={copy.labelVisaPeriod} value={val(application.visaPeriodRaw)} />
      </Section>

      <Section title={copy.sectionExperience}>
        <Field label={copy.colExperience} value={experience} />
        <Field label={copy.labelIndustryTasks} value={val(tasks)} />
      </Section>

      {/* 지원 동기와 검토 메모는 문장이다 — 표 칸에 넣으면 줄이 잘린다. 블록으로 따로 뺀다. */}
      <section className="rcps__sec">
        <h2 className="rcps__st">{copy.labelMotivation}</h2>
        <p className="rcps__p">{val(application.motivation)}</p>
      </section>

      {application.reviewNote ? (
        <section className="rcps__sec">
          <h2 className="rcps__st">{copy.sectionNote}</h2>
          <p className="rcps__p">{application.reviewNote}</p>
        </section>
      ) : null}
    </div>
  );
}
