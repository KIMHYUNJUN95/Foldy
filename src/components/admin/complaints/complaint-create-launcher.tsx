"use client";

// 「컴플레인 등록」 버튼 + 등록 패널의 열림 상태만 들고 있는 얇은 클라이언트 경계.
// 콘솔 본체(`complaints-console.tsx`)는 서버 컴포넌트라 상태를 가질 수 없어서 여기로 분리한다.

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  ComplaintCreatePanel,
  type CreatePanelLabels,
} from "@/components/admin/complaints/complaint-create-panel";
import type { PlacePickRow, ReservationPickRow } from "@/lib/complaint-reservations";

type Props = {
  label: string;
  labels: CreatePanelLabels;
  reservations: ReservationPickRow[];
  places: PlacePickRow[];
};

export function ComplaintCreateLauncher({ label, labels, reservations, places }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="cxw-create" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <ComplaintCreatePanel
          labels={labels}
          reservations={reservations}
          places={places}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
