import type { Locale } from "@/lib/i18n";

/**
 * 공개 법적 고지 · 고객지원 본문 (2026-10-06, App Store 비공개 배포 준비).
 *
 * `/legal/privacy` · `/legal/terms` · `/support` 가 이 파일만 읽는다. 화면 크롬(탭 이름 · 돌아가기 ·
 * 시행일 라벨)은 `dictionary.legal` 에 있고, **긴 본문만** 여기 둔다 — 조항 단위로 세 언어를 나란히
 * 고쳐야 하는 문서라 UI 문구 사전에 흩어 두면 언어 간 조항이 어긋나기 쉽다.
 *
 * 내용은 실제 구현과 맞아야 한다(Apple 심사 · 개인정보 라벨이 이 문서를 기준으로 대조된다).
 * 수집 항목 · 외부 처리자 · 삭제 동작이 바뀌면 이 파일과 `docs/engineering/03-deployment-strategy.md`
 * 「App Store 준비」를 같이 고친다. 공개 출시 전에는 운영 법인명 · 주소를 채우고 법무 검토를 받는다.
 */

export const LEGAL_EFFECTIVE_DATE = "2026-10-23";

export type LegalSection = {
  /** 페이지 안 앵커 (예: 로그인 화면 「보안」 링크 → `#security`). */
  id?: string;
  heading: string;
  paragraphs?: string[];
  items?: string[];
};

export type LegalDocument = {
  title: string;
  summary: string;
  sections: LegalSection[];
};

export type SupportContent = {
  title: string;
  summary: string;
  contactHeading: string;
  contactBody: string;
  faqHeading: string;
  faqs: { q: string; a: string }[];
};

export const privacyPolicy: Record<Locale, LegalDocument> = {
  ko: {
    title: "개인정보처리방침",
    summary:
      "Foldy는 숙박 운영팀을 위한 업무용 서비스입니다. 업무에 필요한 최소한의 정보만 다루며, 광고나 판매 목적으로 개인정보를 쓰거나 제3자에게 팔지 않습니다.",
    sections: [
      {
        heading: "1. 적용 범위",
        paragraphs: [
          "이 방침은 Foldy 모바일 앱 · 웹(이하 「서비스」)에 적용됩니다. 서비스는 소속 조직(숙박 운영 사업자)의 초대를 받은 구성원이 업무 목적으로 이용합니다. 업무 기록에 대해서는 소속 조직이 관리 주체이며, Foldy 운영자는 조직을 대신해 정보를 처리합니다.",
        ],
      },
      {
        heading: "2. 수집하는 정보",
        items: [
          "계정 정보: 이메일 주소, 이름, 생년월일, 성별, 전화번호, 선호 언어. Google 로그인을 선택하면 Google 계정의 이메일 · 이름을 받습니다. 비밀번호는 암호화되어 인증 서비스에만 저장됩니다.",
          "소속 정보: 소속 조직, 역할, 팀, 권한.",
          "근태 정보: 출퇴근 시각, 연차 · 근무 기록, 급여 계산에 필요한 정보. 출퇴근 인증을 할 때에만 그 시점의 위치(GPS)와 기기 정보(브라우저 종류)를 함께 기록합니다.",
          "업무 기록: 청소 · 수리 · 분실물 · 주문 · 할 일 · 게시판 등에서 직접 작성한 글, 댓글, 첨부한 사진.",
          "투숙객 정보: 소속 조직이 예약 관리 시스템(Beds24)과 연동한 경우, 업무 처리에 필요한 예약 정보(투숙객 이름, 숙박 일정, 객실 등)와 투숙객 리뷰.",
          "기술 정보: 로그인 상태 유지와 언어 설정을 위한 쿠키 · 로컬 저장소. 광고 식별자나 추적용 쿠키는 쓰지 않습니다.",
          "오류 진단 정보: 화면에서 오류가 나면 문제를 고치기 위해 오류 내용, 화면 경로, 앱 버전, 기기 · 브라우저 종류를 서버 로그에 기록합니다. 계정과 연결하지 않으며 서버 로그 보관 기간이 지나면 지워집니다.",
          "신분 확인 서류: 외국 국적 구성원은 재류카드 앞면 · 뒷면 사진과 카드에 적힌 정보(로마자 이름, 생년월일, 성별, 국적 · 지역, 주소, 재류카드 번호, 재류자격, 재류기간 만료일, 취로 제한 여부, 자격외활동 허가)를, 일본 국적 구성원은 마이넘버 카드 앞면 사진과 앞면 정보(이름, 생년월일, 성별, 주소)를 받습니다. 마이넘버(개인번호)는 받지 않으며, 사진에 개인번호가 보이면 저장하지 않고 다시 찍도록 안내합니다.",
        ],
      },
      {
        heading: "3. 이용 목적",
        items: [
          "로그인, 본인 확인, 소속 조직 · 권한에 따른 접근 제어",
          "청소 · 근태 · 연차 · 급여 등 숙박 운영 업무의 기록과 처리",
          "조직 내 공지 · 게시판 · 알림 등 업무 소통",
          "서비스 오류 대응과 보안 유지",
          "고용 시 취로 자격 확인, 외국인 고용 상황 신고 등 소속 조직의 법령상 확인 업무와 직원 정보 관리",
        ],
      },
      {
        heading: "4. 위치 정보와 카메라",
        paragraphs: [
          "위치 정보는 출퇴근 인증 버튼을 누르거나 출퇴근 QR을 스캔한 그 순간에만 한 번 확인하며, 백그라운드에서 위치를 추적하지 않습니다. 출퇴근 인증은 근무지 반경 안에 있는지 확인해야 하므로 위치 권한이 필요하며, 거부하면 출퇴근 인증을 할 수 없습니다. 인증에 실패한 시도도 그 시점의 위치와 함께 기록됩니다. 다른 기능은 위치 권한 없이 사용할 수 있습니다.",
          "카메라는 출퇴근 QR 코드를 읽을 때 사용하며 영상은 저장하지 않습니다. 사진은 이용자가 직접 촬영하거나 선택해 첨부한 경우에만 업로드됩니다.",
        ],
      },
      {
        heading: "4-1. 신분 확인 서류와 글자 자동 읽기",
        paragraphs: [
          "신분 확인 서류 사진은 Foldy의 비공개 저장소(일본 도쿄 리전)에 저장되며, 본인과 소속 조직에서 서류 열람 권한을 받은 관리자만 볼 수 있습니다.",
          "등록할 때 이용자가 동의한 경우에만, 카드의 글자를 자동으로 읽기 위해 사진을 미국의 Anthropic, PBC가 제공하는 글자 인식 AI 서비스(Claude API)로 보냅니다. 동의하지 않아도 사진만 올리고 정보를 직접 입력해 등록할 수 있습니다. 동의는 등록할 때마다 따로 묻고, 다음 등록에서 동의하지 않는 것으로 언제든 철회할 수 있습니다.",
        ],
        items: [
          "받는 곳: Anthropic, PBC(미국). 우리 지시에 따라 글자 읽기만 처리하는 처리자이며, 계약상 받은 데이터를 AI 학습에 쓰지 않습니다.",
          "받는 곳의 보관: 보통 30일 안에 자동 삭제됩니다. 다만 Anthropic의 안전 점검 시스템이 이용 정책 위반 가능성으로 표시한 경우 최대 2년, 법령상 보관 의무가 있는 경우 그 기간 동안 보관될 수 있습니다.",
          "이전되는 나라: 미국.",
          "미국의 개인정보 보호 제도: 미국에는 연방 차원의 포괄적인 개인정보 보호법이 없고 분야별 법률(예: 의료 HIPAA, 금융 GLBA, 통신 ECPA)이 있으며, Anthropic의 소재지인 캘리포니아주에는 포괄적인 법률로 캘리포니아 소비자 프라이버시법(CCPA)이 있습니다. 미국은 EU 적정성 결정을 받지 않았고 APEC CBPR에 참여하고 있습니다. 자세한 내용은 일본 개인정보보호위원회의 「외국의 개인정보 보호 제도 조사(미국)」를 참고하세요: https://www.ppc.go.jp/enforcement/infoprovision/laws/offshore_report_america/",
          "받는 곳의 보호 조치: 데이터 처리 계약에 따른 처리, 전송 · 저장 암호화, 접근 통제 등.",
          "보관 기간: 재직 중에는 현재 서류와 이전 서류(갱신 이력)를 보관하고, 퇴사 후 3년이 지나면 사진과 정보를 삭제합니다. 계정을 삭제해도 소속 조직의 고용 확인 기록으로 퇴사 후 3년까지 보관한 뒤 삭제합니다.",
        ],
      },
      {
        heading: "5. 외부 처리자와 국외 이전",
        paragraphs: [
          "서비스 운영을 위해 아래 업체에 정보 처리를 맡깁니다. 이 업체들의 서버는 이용자가 있는 국가 밖에 있을 수 있습니다.",
        ],
        items: [
          "Supabase — 데이터베이스, 인증, 파일 저장",
          "Vercel — 서비스 호스팅",
          "Google — Google 로그인(선택한 경우에만)",
          "Beds24 — 예약 정보 연동(소속 조직이 연동한 경우)",
          "DeepL — 투숙객 리뷰 번역",
          "Slack — 소속 조직의 내부 운영 알림",
          "Anthropic — 신분 확인 서류 사진의 글자 읽기(이용자가 동의한 경우에만, 미국)",
        ],
      },
      {
        heading: "6. 보관과 파기",
        paragraphs: [
          "계정 화면 → 보안 → 「계정 삭제」에서 언제든 계정을 삭제할 수 있습니다. 삭제하면 로그인 계정이 즉시 지워지고, 프로필의 이름 · 연락처 등 개인 식별 정보가 삭제되며, 조직 소속도 해제됩니다.",
          "이미 처리된 업무 기록(청소 · 근태 기록 등)은 소속 조직의 운영 · 법정 보존 기록으로 남을 수 있습니다. 이 경우에도 개인 식별 정보는 지워진 상태로 남습니다.",
          "신분 확인 서류는 위 4-1의 기간에 따라 별도로 보관 · 삭제됩니다.",
        ],
      },
      {
        heading: "7. 이용자의 권리",
        paragraphs: [
          "이용자는 계정 화면에서 자신의 정보를 열람 · 수정할 수 있고, 계정을 삭제할 수 있습니다. 그 밖의 열람 · 정정 · 삭제 요청은 소속 조직 관리자 또는 아래 문의처로 연락해 주세요.",
        ],
      },
      {
        id: "security",
        heading: "8. 보안",
        items: [
          "모든 통신은 암호화(HTTPS)됩니다.",
          "데이터는 조직 단위로 분리되며, 다른 조직의 정보에는 접근할 수 없습니다.",
          "역할 · 권한에 따라 볼 수 있는 정보가 서버에서 제한됩니다.",
          "비밀번호는 원문으로 저장하지 않습니다.",
        ],
      },
      {
        heading: "9. 아동",
        paragraphs: ["서비스는 업무용이며 아동을 대상으로 하지 않습니다."],
      },
      {
        heading: "10. 방침 변경",
        paragraphs: [
          "이 방침을 바꾸면 이 페이지의 시행일을 갱신하고, 중요한 변경은 서비스 안에서 알립니다.",
        ],
      },
      {
        heading: "11. 문의",
        paragraphs: ["개인정보 관련 문의는 고객지원 페이지의 연락처로 보내 주세요."],
      },
    ],
  },
  ja: {
    title: "プライバシーポリシー",
    summary:
      "Foldyは宿泊施設の運営チーム向けの業務用サービスです。業務に必要な最小限の情報のみを扱い、広告や販売の目的で個人情報を利用したり、第三者に販売したりすることはありません。",
    sections: [
      {
        heading: "1. 適用範囲",
        paragraphs: [
          "本ポリシーは、Foldyのモバイルアプリおよびウェブ（以下「本サービス」）に適用されます。本サービスは、所属組織（宿泊施設の運営事業者）から招待を受けたメンバーが業務目的で利用します。業務記録については所属組織が管理主体となり、Foldy運営者は組織に代わって情報を取り扱います。",
        ],
      },
      {
        heading: "2. 取得する情報",
        items: [
          "アカウント情報：メールアドレス、氏名、生年月日、性別、電話番号、使用言語。Googleログインを選択した場合は、Googleアカウントのメールアドレスと氏名を受け取ります。パスワードは暗号化され、認証サービスにのみ保存されます。",
          "所属情報：所属組織、役割、チーム、権限。",
          "勤怠情報：出退勤時刻、休暇・勤務記録、給与計算に必要な情報。出退勤の認証時にのみ、その時点の位置情報（GPS）と端末情報（ブラウザの種類）を記録します。",
          "業務記録：清掃・修理・遺失物・注文・タスク・掲示板などでご本人が作成した投稿、コメント、添付した写真。",
          "宿泊者情報：所属組織が予約管理システム（Beds24）と連携している場合、業務に必要な予約情報（宿泊者氏名、宿泊日程、客室など）と宿泊者のレビュー。",
          "技術情報：ログイン状態の維持と言語設定のためのCookie・ローカルストレージ。広告識別子やトラッキング用Cookieは使用しません。",
          "エラー診断情報：画面でエラーが発生した場合、問題を修正するためにエラー内容、画面のパス、アプリのバージョン、端末・ブラウザの種類をサーバーログに記録します。アカウントとは紐付けず、サーバーログの保存期間が過ぎると削除されます。",
          "本人確認書類：外国籍のメンバーからは在留カードの表面・裏面の写真とカードに記載された情報（ローマ字氏名、生年月日、性別、国籍・地域、住居地、在留カード番号、在留資格、在留期間満了日、就労制限の有無、資格外活動許可）を、日本国籍のメンバーからはマイナンバーカード表面の写真と表面の情報（氏名、生年月日、性別、住所）を取得します。マイナンバー（個人番号）は取得せず、写真に個人番号が写っている場合は保存せずに撮り直しを案内します。",
        ],
      },
      {
        heading: "3. 利用目的",
        items: [
          "ログイン、本人確認、所属組織・権限に応じたアクセス制御",
          "清掃・勤怠・休暇・給与など宿泊施設運営業務の記録と処理",
          "組織内のお知らせ・掲示板・通知などの業務連絡",
          "障害対応とセキュリティの維持",
          "雇用時の就労資格の確認、外国人雇用状況の届出など所属組織の法令上の確認業務と従業員情報の管理",
        ],
      },
      {
        heading: "4. 位置情報とカメラ",
        paragraphs: [
          "位置情報は、出退勤の認証ボタンを押したとき、または出退勤QRを読み取ったその瞬間に一度だけ確認します。バックグラウンドで位置を追跡することはありません。出退勤の認証では勤務地の範囲内にいることを確認するため位置情報の許可が必要で、拒否すると出退勤の認証はできません。認証に失敗した試行も、その時点の位置情報とともに記録されます。その他の機能は位置情報の許可なしで利用できます。",
          "カメラは出退勤用QRコードの読み取りに使用し、映像は保存しません。写真は、ご本人が撮影または選択して添付した場合にのみアップロードされます。",
        ],
      },
      {
        heading: "4-1. 本人確認書類と文字の自動読み取り",
        paragraphs: [
          "本人確認書類の写真は Foldy の非公開ストレージ（日本・東京リージョン）に保存され、本人と、所属組織で書類閲覧権限を付与された管理者だけが閲覧できます。",
          "登録時に利用者が同意した場合に限り、カードの文字を自動で読み取るため、写真を米国の Anthropic, PBC が提供する文字認識 AI サービス（Claude API）へ送信します。同意しなくても、写真だけをアップロードして情報を手入力すれば登録できます。同意は登録のたびに個別に確認し、次回の登録で同意しないことでいつでも撤回できます。",
        ],
        items: [
          "提供先：Anthropic, PBC（米国）。当社の指示に従って文字の読み取りのみを行う委託先であり、契約上、受け取ったデータを AI の学習に使用しません。",
          "提供先での保管：通常30日以内に自動で削除されます。ただし、Anthropic の安全確認システムが利用ポリシー違反の可能性を検知した場合は最長2年間、法令上の保存義務がある場合はその期間保管されることがあります。",
          "移転先の国：米国。",
          "米国の個人情報保護制度：米国には連邦レベルの包括的な個人情報保護法はなく、分野別の法律（例：医療 HIPAA、金融 GLBA、通信 ECPA）があります。Anthropic の所在地であるカリフォルニア州には包括的な法律としてカリフォルニア州消費者プライバシー法（CCPA）があります。米国は EU の十分性認定を受けておらず、APEC の CBPR システムに参加しています。詳しくは個人情報保護委員会「外国における個人情報の保護に関する制度等の調査（アメリカ）」をご覧ください：https://www.ppc.go.jp/enforcement/infoprovision/laws/offshore_report_america/",
          "提供先の保護措置：データ処理契約に基づく取り扱い、通信・保存時の暗号化、アクセス制御など。",
          "保管期間：在職中は現在の書類と以前の書類（更新履歴）を保管し、退職後3年が経過した時点で写真と情報を削除します。アカウントを削除しても、所属組織の雇用確認記録として退職後3年間保管したうえで削除します。",
        ],
      },
      {
        heading: "5. 外部委託先と国外移転",
        paragraphs: [
          "本サービスの運営のため、以下の事業者に情報の取り扱いを委託しています。これらの事業者のサーバーは、利用者の居住国外にある場合があります。",
        ],
        items: [
          "Supabase — データベース、認証、ファイル保存",
          "Vercel — サービスのホスティング",
          "Google — Googleログイン（選択した場合のみ）",
          "Beds24 — 予約情報の連携（所属組織が連携している場合）",
          "DeepL — 宿泊者レビューの翻訳",
          "Slack — 所属組織の社内運営通知",
          "Anthropic — 本人確認書類の写真の文字読み取り（利用者が同意した場合のみ、米国）",
        ],
      },
      {
        heading: "6. 保存と削除",
        paragraphs: [
          "アカウント画面 → セキュリティ → 「アカウント削除」から、いつでもアカウントを削除できます。削除すると、ログインアカウントは直ちに削除され、プロフィールの氏名・連絡先などの個人を特定できる情報が消去され、組織への所属も解除されます。",
          "すでに処理された業務記録（清掃・勤怠記録など）は、所属組織の運営記録・法定保存記録として残る場合があります。その場合も、個人を特定できる情報は消去された状態で残ります。",
          "本人確認書類は、上記 4-1 の期間に従って別途保管・削除します。",
        ],
      },
      {
        heading: "7. 利用者の権利",
        paragraphs: [
          "利用者はアカウント画面でご自身の情報を閲覧・修正し、アカウントを削除できます。その他の開示・訂正・削除のご要望は、所属組織の管理者または下記のお問い合わせ先までご連絡ください。",
        ],
      },
      {
        id: "security",
        heading: "8. セキュリティ",
        items: [
          "すべての通信は暗号化（HTTPS）されます。",
          "データは組織単位で分離され、他の組織の情報にはアクセスできません。",
          "役割・権限に応じて、閲覧できる情報がサーバー側で制限されます。",
          "パスワードを平文で保存することはありません。",
        ],
      },
      {
        heading: "9. 子ども",
        paragraphs: ["本サービスは業務用であり、子どもを対象としていません。"],
      },
      {
        heading: "10. ポリシーの変更",
        paragraphs: [
          "本ポリシーを変更する場合は、このページの施行日を更新し、重要な変更は本サービス内でお知らせします。",
        ],
      },
      {
        heading: "11. お問い合わせ",
        paragraphs: ["個人情報に関するお問い合わせは、サポートページの連絡先までお送りください。"],
      },
    ],
  },
  en: {
    title: "Privacy Policy",
    summary:
      "Foldy is a work tool for accommodation operations teams. We handle only the information the work requires, and we never use personal data for advertising or sell it to third parties.",
    sections: [
      {
        heading: "1. Scope",
        paragraphs: [
          "This policy applies to the Foldy mobile app and web (the \"Service\"). The Service is used for work by members invited by their organization (an accommodation operator). The organization controls its work records; the Foldy operator processes information on the organization's behalf.",
        ],
      },
      {
        heading: "2. Information we collect",
        items: [
          "Account: email address, name, date of birth, gender, phone number, preferred language. If you choose Google sign-in, we receive your Google account email and name. Passwords are stored only in hashed form by the authentication service.",
          "Membership: organization, role, team, permissions.",
          "Attendance: clock-in/out times, leave and shift records, and information needed for payroll. Only when you verify a clock-in or clock-out do we record your location (GPS) at that moment and device information (browser type).",
          "Work records: posts, comments and photos you create in cleaning, maintenance, lost & found, orders, tasks, the board and similar features.",
          "Guest data: if your organization connects its booking system (Beds24), the reservation details needed for operations (guest name, stay dates, room, etc.) and guest reviews.",
          "Technical: cookies and local storage to keep you signed in and remember your language. We do not use advertising identifiers or tracking cookies.",
          "Error diagnostics: when a screen hits an error, we record the error details, the screen path, the app version and the device / browser type in our server logs so we can fix it. This is not linked to your account and is deleted when the server log retention period ends.",
          "Identity documents: from members who are not Japanese nationals, photos of the front and back of the residence card and the information printed on it (name in Latin letters, date of birth, sex, nationality/region, address, residence card number, status of residence, expiry date, work restriction, permission for extra activities); from Japanese nationals, a photo of the front of the My Number card and the information on the front (name, date of birth, sex, address). We never collect the individual number (My Number); if it appears in a photo, the photo is not saved and you are asked to retake it.",
        ],
      },
      {
        heading: "3. How we use it",
        items: [
          "Sign-in, identity verification and access control by organization and permission",
          "Recording and processing operations work such as cleaning, attendance, leave and payroll",
          "Work communication inside the organization: announcements, board, notifications",
          "Troubleshooting and keeping the Service secure",
          "Checking eligibility to work at hiring, the foreign-worker employment report and other legal checks by your organization, and managing staff records",
        ],
      },
      {
        heading: "4. Location and camera",
        paragraphs: [
          "Location is checked once, only at the moment you tap clock-in/out or scan the attendance QR code. We never track location in the background. Clock-in/out verification needs location permission to confirm you are within the work site's range; if you deny it, you cannot verify a clock-in or clock-out. Failed attempts are also recorded with the location at that moment. All other features work without location permission.",
          "The camera is used to read the attendance QR code; video is never stored. Photos are uploaded only when you take or choose them yourself.",
        ],
      },
      {
        heading: "4-1. Identity documents and automatic text reading",
        paragraphs: [
          "Photos of identity documents are stored in Foldy’s private storage (Tokyo region, Japan) and can be viewed only by you and by admins your organization has given permission to view documents.",
          "Only if you agree when registering, the photos are sent to a text-recognition AI service (Claude API) provided by Anthropic, PBC in the United States to read the text on the card automatically. You can still register without agreeing by uploading the photos and typing the details yourself. Consent is asked separately each time you register, and you can withdraw it at any time by not agreeing at your next registration.",
        ],
        items: [
          "Recipient: Anthropic, PBC (United States). It processes the photos only to read the text, on our instructions, and is contractually prohibited from using the data to train AI.",
          "Retention by the recipient: usually deleted automatically within 30 days. If Anthropic’s safety systems flag a request as a possible usage-policy violation, it may be kept for up to 2 years, or longer where the law requires.",
          "Country of transfer: United States.",
          "Personal-information protection in the United States: there is no comprehensive federal privacy law; sector-specific laws apply (e.g. HIPAA for health, GLBA for finance, ECPA for communications). California, where Anthropic is based, has a comprehensive law, the California Consumer Privacy Act (CCPA). The United States has no EU adequacy decision and participates in the APEC CBPR system. For details, see the Personal Information Protection Commission of Japan’s survey of foreign systems (United States): https://www.ppc.go.jp/enforcement/infoprovision/laws/offshore_report_america/",
          "Recipient’s safeguards: processing under a data processing agreement, encryption in transit and at rest, access controls and similar measures.",
          "Retention period: while you work for the organization we keep the current and previous documents (renewal history); photos and information are deleted 3 years after you leave. Even if you delete your account, they are kept as your organization’s employment-check record until 3 years after you leave, then deleted.",
        ],
      },
      {
        heading: "5. Service providers and international transfer",
        paragraphs: [
          "We rely on the following providers to run the Service. Their servers may be located outside your country.",
        ],
        items: [
          "Supabase — database, authentication, file storage",
          "Vercel — hosting",
          "Google — Google sign-in (only if you choose it)",
          "Beds24 — reservation sync (if your organization connects it)",
          "DeepL — translation of guest reviews",
          "Slack — internal operations alerts for your organization",
          "Anthropic — reading text on identity-document photos (only if you agree; United States)",
        ],
      },
      {
        heading: "6. Retention and deletion",
        paragraphs: [
          "You can delete your account at any time from Account → Security → \"Delete account\". Deleting removes your sign-in account immediately, erases identifying profile information such as your name and contact details, and removes you from your organization.",
          "Work records that were already processed (such as cleaning or attendance records) may remain as your organization's operational or legally required records. Even then, they remain with your identifying information erased.",
          "Identity documents are kept and deleted separately according to section 4-1 above.",
        ],
      },
      {
        heading: "7. Your rights",
        paragraphs: [
          "You can view and edit your information and delete your account from the Account screen. For any other access, correction or deletion request, contact your organization's administrator or the contact below.",
        ],
      },
      {
        id: "security",
        heading: "8. Security",
        items: [
          "All traffic is encrypted (HTTPS).",
          "Data is separated per organization; no organization can access another's data.",
          "What you can see is restricted on the server according to your role and permissions.",
          "Passwords are never stored in plain text.",
        ],
      },
      {
        heading: "9. Children",
        paragraphs: ["The Service is a work tool and is not directed at children."],
      },
      {
        heading: "10. Changes",
        paragraphs: [
          "When this policy changes we update the effective date on this page, and we announce significant changes inside the Service.",
        ],
      },
      {
        heading: "11. Contact",
        paragraphs: ["For privacy questions, use the contact on the Support page."],
      },
    ],
  },
};

export const termsOfService: Record<Locale, LegalDocument> = {
  ko: {
    title: "이용약관",
    summary:
      "Foldy는 숙박 운영 사업자와 그 구성원이 업무에 쓰는 서비스입니다. 이 약관은 서비스를 이용할 때 지켜야 할 기본 규칙을 정합니다.",
    sections: [
      {
        heading: "1. 서비스",
        paragraphs: [
          "Foldy(이하 「서비스」)는 청소 · 근태 · 예약 · 수리 · 분실물 · 주문 등 숙박 운영 업무를 기록하고 처리하는 업무용 도구입니다. 소속 조직의 초대를 받은 구성원만 이용할 수 있습니다.",
        ],
      },
      {
        heading: "2. 계정",
        items: [
          "가입할 때 정확한 정보를 입력해야 합니다.",
          "계정과 비밀번호는 본인만 사용해야 하며, 다른 사람과 공유하지 않습니다.",
          "계정이 도용된 것으로 보이면 즉시 소속 조직 관리자에게 알려 주세요.",
        ],
      },
      {
        heading: "3. 조직과 권한",
        paragraphs: [
          "소속 조직의 관리자는 구성원의 역할 · 권한을 정하고, 계정을 정지하거나 조직에서 제외할 수 있습니다. 이용자가 볼 수 있는 정보와 할 수 있는 작업은 부여된 권한에 따라 달라집니다.",
        ],
      },
      {
        heading: "4. 금지 행위",
        items: [
          "다른 사람의 계정을 사용하거나 권한 없는 정보에 접근하려는 행위",
          "투숙객 · 동료의 개인정보를 업무 외 목적으로 이용하거나 외부에 유출하는 행위",
          "불법적이거나 타인을 괴롭히는 등 부적절한 콘텐츠를 올리는 행위",
          "서비스의 정상적인 운영을 방해하는 행위",
        ],
      },
      {
        heading: "5. 콘텐츠",
        paragraphs: [
          "이용자가 작성한 글 · 사진은 소속 조직의 업무 기록으로 이용됩니다. 작성한 콘텐츠에 대한 책임은 작성자에게 있습니다. 이 약관을 어긴 콘텐츠는 소속 조직 관리자나 운영자가 삭제할 수 있습니다.",
        ],
      },
      {
        heading: "6. 서비스 변경과 중단",
        paragraphs: [
          "기능은 개선을 위해 바뀔 수 있습니다. 점검이나 장애, 외부 연동 서비스(예약 관리 시스템 등)의 사정으로 서비스가 일시적으로 중단되거나 정보가 늦게 반영될 수 있습니다.",
        ],
      },
      {
        heading: "7. 책임의 한계",
        paragraphs: [
          "운영자는 서비스를 안정적으로 제공하기 위해 노력하지만, 법령이 허용하는 범위에서 외부 연동 데이터의 지연 · 오류나 이용자의 잘못된 사용으로 생긴 손해에 대해서는 책임을 지지 않습니다.",
        ],
      },
      {
        heading: "8. 이용 종료",
        paragraphs: [
          "이용자는 계정 화면 → 보안 → 「계정 삭제」로 언제든 이용을 끝낼 수 있습니다. 이 약관을 중대하게 어기면 이용이 제한될 수 있습니다.",
        ],
      },
      {
        heading: "9. 약관 변경",
        paragraphs: [
          "약관을 바꾸면 이 페이지의 시행일을 갱신하고, 중요한 변경은 서비스 안에서 알립니다. 변경 후에도 계속 이용하면 바뀐 약관에 동의한 것으로 봅니다.",
        ],
      },
      {
        heading: "10. 문의",
        paragraphs: ["약관 관련 문의는 고객지원 페이지의 연락처로 보내 주세요."],
      },
    ],
  },
  ja: {
    title: "利用規約",
    summary:
      "Foldyは、宿泊施設の運営事業者とそのメンバーが業務に使うサービスです。本規約は、本サービスを利用する際に守るべき基本的なルールを定めます。",
    sections: [
      {
        heading: "1. 本サービス",
        paragraphs: [
          "Foldy（以下「本サービス」）は、清掃・勤怠・予約・修理・遺失物・注文など宿泊施設運営の業務を記録・処理するための業務用ツールです。所属組織から招待を受けたメンバーのみが利用できます。",
        ],
      },
      {
        heading: "2. アカウント",
        items: [
          "登録時には正確な情報を入力してください。",
          "アカウントとパスワードはご本人のみが使用し、他人と共有しないでください。",
          "アカウントが不正に使用されたおそれがある場合は、直ちに所属組織の管理者にお知らせください。",
        ],
      },
      {
        heading: "3. 組織と権限",
        paragraphs: [
          "所属組織の管理者は、メンバーの役割・権限を設定し、アカウントの停止や組織からの除外を行うことができます。閲覧できる情報と行える操作は、付与された権限によって異なります。",
        ],
      },
      {
        heading: "4. 禁止事項",
        items: [
          "他人のアカウントを使用する行為、または権限のない情報にアクセスしようとする行為",
          "宿泊者・同僚の個人情報を業務外の目的で利用し、または外部に漏えいする行為",
          "違法な内容や他者への嫌がらせなど、不適切なコンテンツを投稿する行為",
          "本サービスの正常な運営を妨げる行為",
        ],
      },
      {
        heading: "5. コンテンツ",
        paragraphs: [
          "利用者が作成した投稿・写真は、所属組織の業務記録として利用されます。作成したコンテンツの責任は作成者にあります。本規約に違反するコンテンツは、所属組織の管理者または運営者が削除することがあります。",
        ],
      },
      {
        heading: "6. サービスの変更・中断",
        paragraphs: [
          "機能は改善のために変更されることがあります。メンテナンスや障害、外部連携サービス（予約管理システムなど）の事情により、本サービスが一時的に停止したり、情報の反映が遅れたりすることがあります。",
        ],
      },
      {
        heading: "7. 責任の制限",
        paragraphs: [
          "運営者は本サービスを安定して提供するよう努めますが、法令で認められる範囲において、外部連携データの遅延・誤りや利用者の誤った使用によって生じた損害については責任を負いません。",
        ],
      },
      {
        heading: "8. 利用の終了",
        paragraphs: [
          "利用者は、アカウント画面 → セキュリティ → 「アカウント削除」からいつでも利用を終了できます。本規約への重大な違反があった場合、利用が制限されることがあります。",
        ],
      },
      {
        heading: "9. 規約の変更",
        paragraphs: [
          "本規約を変更する場合は、このページの施行日を更新し、重要な変更は本サービス内でお知らせします。変更後も利用を続けた場合、変更後の規約に同意したものとみなします。",
        ],
      },
      {
        heading: "10. お問い合わせ",
        paragraphs: ["規約に関するお問い合わせは、サポートページの連絡先までお送りください。"],
      },
    ],
  },
  en: {
    title: "Terms of Service",
    summary:
      "Foldy is a work service for accommodation operators and their members. These terms set the basic rules for using it.",
    sections: [
      {
        heading: "1. The Service",
        paragraphs: [
          "Foldy (the \"Service\") is a work tool for recording and processing accommodation operations such as cleaning, attendance, reservations, maintenance, lost & found and orders. Only members invited by their organization may use it.",
        ],
      },
      {
        heading: "2. Accounts",
        items: [
          "Provide accurate information when you sign up.",
          "Your account and password are for you alone; do not share them.",
          "If you think your account has been misused, tell your organization's administrator right away.",
        ],
      },
      {
        heading: "3. Organizations and permissions",
        paragraphs: [
          "Your organization's administrators set members' roles and permissions and may suspend an account or remove it from the organization. What you can see and do depends on the permissions you are given.",
        ],
      },
      {
        heading: "4. Prohibited conduct",
        items: [
          "Using someone else's account or trying to access information you are not permitted to see",
          "Using guests' or colleagues' personal data for non-work purposes or disclosing it outside",
          "Posting unlawful, harassing or otherwise inappropriate content",
          "Interfering with the normal operation of the Service",
        ],
      },
      {
        heading: "5. Content",
        paragraphs: [
          "Posts and photos you create are used as your organization's work records. You are responsible for the content you create. Content that breaks these terms may be removed by your organization's administrators or the operator.",
        ],
      },
      {
        heading: "6. Changes and interruptions",
        paragraphs: [
          "Features may change as we improve the Service. Maintenance, outages or connected services (such as a booking system) may temporarily interrupt the Service or delay data.",
        ],
      },
      {
        heading: "7. Limitation of liability",
        paragraphs: [
          "We work to keep the Service reliable, but to the extent permitted by law we are not liable for losses caused by delays or errors in connected-service data or by misuse of the Service.",
        ],
      },
      {
        heading: "8. Ending use",
        paragraphs: [
          "You can stop using the Service at any time via Account → Security → \"Delete account\". Serious violations of these terms may lead to restricted access.",
        ],
      },
      {
        heading: "9. Changes to these terms",
        paragraphs: [
          "When these terms change we update the effective date on this page and announce significant changes inside the Service. Continuing to use the Service after a change means you accept the updated terms.",
        ],
      },
      {
        heading: "10. Contact",
        paragraphs: ["For questions about these terms, use the contact on the Support page."],
      },
    ],
  },
};

/**
 * 계정 삭제 안내 (`/legal/account-deletion`) — Google Play 「계정 삭제 URL」(앱 밖 웹 경로) 용.
 * 실제 삭제 동작(`src/app/account/actions.ts` `deleteAccount`)과 맞아야 한다: 로그인 계정 하드 삭제 +
 * 프로필 이름 · 전화 · 사진 주소 · 생년월일 비움 + 조직 소속 해제. 성별 · 입사일 칸과 업무 기록은 남는다.
 */
export const accountDeletion: Record<Locale, LegalDocument> = {
  ko: {
    title: "계정 삭제 안내",
    summary:
      "Foldy 계정과 관련 개인정보를 삭제하는 방법입니다. 앱을 이미 지웠어도 웹에서 같은 방법으로 삭제할 수 있습니다.",
    sections: [
      {
        heading: "1. 직접 삭제하기 (즉시 처리)",
        items: [
          "Foldy 앱 또는 웹 브라우저에서 로그인합니다.",
          "계정 화면 → 보안 탭으로 이동합니다.",
          "「계정 삭제」를 누르고 확인하면 바로 삭제됩니다.",
        ],
      },
      {
        heading: "2. 로그인할 수 없을 때",
        paragraphs: [
          "가입한 이메일 주소로 아래 문의 메일에 「계정 삭제 요청」을 보내 주세요. 본인 확인 후 30일 이내에 삭제하고 결과를 알려 드립니다.",
        ],
      },
      {
        heading: "3. 삭제되는 정보",
        items: [
          "로그인 계정(이메일 주소, 비밀번호, Google 계정 연결)",
          "프로필의 이름, 전화번호, 프로필 사진, 생년월일",
          "조직 소속(조직 명단에서 사라집니다)",
        ],
      },
      {
        heading: "4. 남는 정보와 보관 기간",
        paragraphs: [
          "이미 처리된 업무 기록(청소 · 근태 · 급여 계산 기록, 작성한 글과 사진 등)은 소속 조직의 운영 기록으로 남으며, 작성자는 「탈퇴한 사용자」로 표시됩니다. 성별 · 입사일 같은 고용 기록 항목도 이름 없이 남을 수 있습니다.",
          "이 기록들은 소속 조직이 따르는 법령상 보존 기간 동안 보관된 뒤 조직의 방침에 따라 정리됩니다.",
        ],
      },
      {
        heading: "5. 되돌릴 수 없습니다",
        paragraphs: [
          "삭제한 계정은 복구할 수 없습니다. 같은 이메일로 다시 가입하려면 소속 조직의 초대 코드가 새로 필요합니다.",
        ],
      },
    ],
  },
  ja: {
    title: "アカウント削除のご案内",
    summary:
      "Foldyのアカウントと関連する個人情報を削除する方法です。アプリを削除済みの場合でも、ウェブから同じ方法で削除できます。",
    sections: [
      {
        heading: "1. ご自身で削除する（即時）",
        items: [
          "Foldyアプリまたはウェブブラウザでログインします。",
          "アカウント画面 → セキュリティタブを開きます。",
          "「アカウント削除」を押して確認すると、すぐに削除されます。",
        ],
      },
      {
        heading: "2. ログインできない場合",
        paragraphs: [
          "ご登録のメールアドレスから、下記のお問い合わせ先へ「アカウント削除依頼」をお送りください。ご本人確認のうえ、30日以内に削除し、結果をお知らせします。",
        ],
      },
      {
        heading: "3. 削除される情報",
        items: [
          "ログインアカウント（メールアドレス、パスワード、Googleアカウント連携）",
          "プロフィールの氏名、電話番号、プロフィール写真、生年月日",
          "組織への所属（組織の名簿から表示されなくなります）",
        ],
      },
      {
        heading: "4. 残る情報と保存期間",
        paragraphs: [
          "すでに処理された業務記録（清掃・勤怠・給与計算の記録、作成した投稿や写真など）は所属組織の運営記録として残り、作成者は「退会済みユーザー」と表示されます。性別・入社日などの雇用記録項目も、氏名を除いた状態で残る場合があります。",
          "これらの記録は、所属組織が従う法令上の保存期間のあいだ保管され、その後は組織の方針に従って整理されます。",
        ],
      },
      {
        heading: "5. 元に戻せません",
        paragraphs: [
          "削除したアカウントは復元できません。同じメールアドレスで再登録するには、所属組織の招待コードが改めて必要です。",
        ],
      },
    ],
  },
  en: {
    title: "Deleting your account",
    summary:
      "How to delete your Foldy account and the personal data tied to it. Even if you have already removed the app, you can do the same on the web.",
    sections: [
      {
        heading: "1. Delete it yourself (immediate)",
        items: [
          "Sign in to the Foldy app or in a web browser.",
          "Go to Account → Security.",
          "Tap \"Delete account\" and confirm. The account is deleted right away.",
        ],
      },
      {
        heading: "2. If you can't sign in",
        paragraphs: [
          "Email an \"Account deletion request\" to the support address below from the email you registered with. We verify it's you and delete the account within 30 days, then let you know.",
        ],
      },
      {
        heading: "3. What is deleted",
        items: [
          "Your sign-in account (email address, password, Google account link)",
          "Your profile name, phone number, profile photo and date of birth",
          "Your organization membership (you disappear from the roster)",
        ],
      },
      {
        heading: "4. What remains, and for how long",
        paragraphs: [
          "Work records that were already processed (cleaning, attendance and payroll records, posts and photos you created, etc.) remain as your organization's operational records, shown as \"Deleted user\". Employment fields such as gender and hire date may also remain, without your name.",
          "These records are kept for the retention period required by the laws your organization follows, then handled under the organization's own policy.",
        ],
      },
      {
        heading: "5. This can't be undone",
        paragraphs: [
          "A deleted account can't be restored. To sign up again with the same email you'll need a new invite code from your organization.",
        ],
      },
    ],
  },
};

export const supportContent: Record<Locale, SupportContent> = {
  ko: {
    title: "고객지원",
    summary: "Foldy 이용 중 문제가 있거나 궁금한 점이 있으면 아래를 확인해 주세요.",
    contactHeading: "문의하기",
    contactBody:
      "업무 · 권한 관련 문의는 먼저 소속 조직 관리자에게 연락해 주세요. 앱 오류나 계정 문제는 아래 메일로 보내 주시면 확인 후 답변드립니다. 로그인한 상태라면 앱 메뉴의 「버그 신고」도 이용할 수 있습니다.",
    faqHeading: "자주 묻는 질문",
    faqs: [
      {
        q: "가입하려면 무엇이 필요한가요?",
        a: "소속 조직에서 받은 초대 코드가 필요합니다. 이메일 또는 Google로 로그인한 뒤 초대 코드를 입력하면 조직에 합류합니다.",
      },
      {
        q: "비밀번호를 잊어버렸어요.",
        a: "로그인 화면에서 「이메일로 계속하기」를 누른 뒤 비밀번호 칸의 「잊으셨나요?」를 누르면 재설정 메일을 받을 수 있습니다.",
      },
      {
        q: "표시 언어를 바꾸고 싶어요.",
        a: "계정 화면 → 프로필에서 한국어 · 日本語 · English 중에서 고를 수 있습니다.",
      },
      {
        q: "계정을 삭제하려면 어떻게 하나요?",
        a: "계정 화면 → 보안 → 「계정 삭제」에서 바로 삭제할 수 있습니다. 삭제하면 되돌릴 수 없습니다.",
      },
      {
        q: "로그인했는데 「계정이 정지되었습니다」 같은 화면이 떠요.",
        a: "소속 조직에서 계정이 정지되었거나 조직에서 제외된 상태입니다. 소속 조직 관리자에게 문의해 주세요. 계정이 비활성화된 경우에는 아래 메일로 연락해 주세요.",
      },
    ],
  },
  ja: {
    title: "サポート",
    summary: "Foldyのご利用中に問題やご不明な点がありましたら、以下をご確認ください。",
    contactHeading: "お問い合わせ",
    contactBody:
      "業務・権限に関するお問い合わせは、まず所属組織の管理者にご連絡ください。アプリの不具合やアカウントの問題は、下記のメールアドレスまでお送りいただければ確認のうえご返信します。ログイン中であれば、アプリのメニューにある「バグ報告」もご利用いただけます。",
    faqHeading: "よくある質問",
    faqs: [
      {
        q: "登録には何が必要ですか？",
        a: "所属組織から受け取った招待コードが必要です。メールまたはGoogleでログインしたあと、招待コードを入力すると組織に参加できます。",
      },
      {
        q: "パスワードを忘れました。",
        a: "ログイン画面で「メールで続ける」を押し、パスワード欄の「お忘れですか？」を押すと、再設定メールを受け取れます。",
      },
      {
        q: "表示言語を変更したいです。",
        a: "アカウント画面 → プロフィールで、한국어・日本語・Englishから選べます。",
      },
      {
        q: "アカウントを削除するには？",
        a: "アカウント画面 → セキュリティ → 「アカウント削除」からすぐに削除できます。削除は取り消せません。",
      },
      {
        q: "ログインしたら「アカウントが停止されました」などの画面が表示されます。",
        a: "所属組織でアカウントが停止されたか、組織から除外された状態です。所属組織の管理者にお問い合わせください。無効化された場合は、下記のメールアドレスまでご連絡ください。",
      },
    ],
  },
  en: {
    title: "Support",
    summary: "If something isn't working or you have a question about Foldy, start here.",
    contactHeading: "Contact us",
    contactBody:
      "For questions about your work or permissions, contact your organization's administrator first. For app problems or account issues, email us at the address below and we'll get back to you. If you're signed in, you can also use \"Bug Report\" in the app menu.",
    faqHeading: "Frequently asked questions",
    faqs: [
      {
        q: "What do I need to sign up?",
        a: "An invite code from your organization. Sign in with email or Google, then enter the invite code to join your organization.",
      },
      {
        q: "I forgot my password.",
        a: "On the sign-in screen, choose \"Continue with email\", then tap \"Forgot?\" next to the password field to get a reset email.",
      },
      {
        q: "How do I change the display language?",
        a: "Go to Account → Profile and choose 한국어, 日本語 or English.",
      },
      {
        q: "How do I delete my account?",
        a: "Go to Account → Security → \"Delete account\". Deletion can't be undone.",
      },
      {
        q: "I signed in but see \"Your account is suspended\" or a similar screen.",
        a: "Your organization suspended your account or removed you. Please contact your organization's administrator. If your account was disabled, email us at the address below.",
      },
    ],
  },
};
