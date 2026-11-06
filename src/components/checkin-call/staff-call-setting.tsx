"use client";

// 건물 설정 · 직원 통화 켜기/끄기(docs/product/46 §6) — 설정 폼과 따로 누르면 바로 저장한다. 권한 `checkin.manage` 는 서버가 다시 본다.
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setCheckinStaffCallEnabled } from "@/actions/checkin/settings";
import type { CheckinCopy } from "@/components/admin/checkin/checkin-copy";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { haptic } from "@/lib/haptics";

export function StaffCallSetting({ propertyKey, enabled, copy }: { propertyKey: string; enabled: boolean; copy: CheckinCopy }) {
  const router = useRouter();
  const { toast, showToast, dismiss } = useAdminToast();
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    startTransition(async () => {
      const result = await setCheckinStaffCallEnabled(propertyKey, next).catch(() => null);
      if (result?.ok) {
        haptic("light");
        setOn(result.enabled);
        router.refresh();
      } else {
        haptic("error");
        showToast(copy.staffCallFailed);
      }
    });
  }

  return (
    <div className="ck">
      <section className="ck-set" aria-labelledby="ck-s-staff-call">
        <div>
          <h3 id="ck-s-staff-call">{copy.secStaffCall}</h3>
          <p className="ck-set__d">{copy.secStaffCallBody}</p>
        </div>
        <div className="ck-set__b">
          <div className="ck-checks">
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby="ck-s-staff-call"
              aria-busy={pending}
              disabled={pending}
              className={`ck-check${on ? " on" : ""}`}
              onClick={toggle}
            >
              <i aria-hidden="true">
                <Check />
              </i>
              {on ? copy.staffCallOn : copy.staffCallOff}
            </button>
          </div>
        </div>
      </section>
      {toast ? <AdminToast key={toast.id} message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}
