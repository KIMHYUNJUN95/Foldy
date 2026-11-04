"use client";

// 셀프 체크인 · 기기(시안 S7 · S7b) — 태블릿 목록 · 「기기 추가」(8자리 등록 코드 10분 · 1회) · 이름 바꾸기 · 폐기(확인 창).
// 권한 `checkin.manage`. 등록 코드는 받은 순간 화면에만 있다. 패널을 닫거나 다른 태블릿용 코드를 더 받아도 살아 있고(적어 두고 태블릿으로 가는 흐름), 「새 코드」는 보이는 그 코드만 끝낸다.
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, TriangleAlert, X } from "lucide-react";
import {
  invalidateCheckinEnrollmentCode,
  issueCheckinEnrollmentCode,
  renameCheckinDevice,
  revokeCheckinDevice,
  type CheckinDevice,
  type ListCheckinDevicesResult,
} from "@/actions/checkin/devices";
import { AdmDropdown } from "@/components/admin/shared/adm-dropdown";
import { AdminToast, useAdminToast } from "@/components/admin/shared/admin-toast";
import { useAdminPanelA11y } from "@/components/admin/shared/use-admin-panel-a11y";
import { useBuildingName } from "@/components/shared/building-names";
import { haptic } from "@/lib/haptics";
import { formatRemaining, formatTokyoStamp, groupEnrollmentCode, summarizeDevices } from "@/lib/checkin/staff-view";
import { fill, type CheckinCopy, type CheckinSharedCopy } from "./checkin-copy";
import { CheckinState } from "./checkin-ui";
import "./checkin.css";

type Panel = { kind: "add" } | { kind: "device"; id: string } | null;

export function CheckinDevicesConsole({
  copy,
  shared,
  properties,
  result,
}: {
  copy: CheckinCopy;
  shared: CheckinSharedCopy;
  properties: { key: string; name: string }[];
  result: ListCheckinDevicesResult;
}) {
  const router = useRouter();
  const buildingName = useBuildingName();
  const { toast, showToast, dismiss } = useAdminToast();
  const [, startTransition] = useTransition();
  const [panel, setPanel] = useState<Panel>(null);
  const refresh = () => startTransition(() => router.refresh());

  const addButton = (
    <button type="button" className="ck-btn is-pri" onClick={() => setPanel({ kind: "add" })}>
      <Plus aria-hidden="true" />
      {copy.addDevice}
    </button>
  );

  if (!result.ok) {
    const kind = result.errorKey === "forbidden" ? "forbidden" : result.errorKey === "not_ready" ? "notReady" : "error";
    return (
      <div className="ck">
        <CheckinState
          kind={kind}
          title={kind === "forbidden" ? shared.noAccessTitle : kind === "notReady" ? copy.notReadyTitle : copy.devicesErrorTitle}
          body={kind === "forbidden" ? shared.noAccessBody : kind === "notReady" ? copy.notReadyBody : copy.errorBody}
          action={
            kind === "error" ? (
              <button type="button" className="ck-btn is-sm" onClick={refresh}>
                {copy.retry}
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const { devices } = result;
  const sum = summarizeDevices(devices);
  const selected = panel?.kind === "device" ? (devices.find((device) => device.id === panel.id) ?? null) : null;

  return (
    <div className="ck">
      <div className="ck-bar">
        <span className="ck-soft num">{fill(copy.deviceSummary, { total: sum.total, connected: sum.connected, disconnected: sum.disconnected })}</span>
        <span className="ck-sp" />
        {addButton}
      </div>

      {devices.length === 0 ? (
        <CheckinState kind="empty" title={copy.devicesEmptyTitle} body={copy.devicesEmptyBody} />
      ) : (
        <div>
          <div className="ck-dth" aria-hidden="true">
            <span>{copy.colName}</span>
            <span>{copy.colProperty}</span>
            <span>{copy.colModel}</span>
            <span>{copy.colApp}</span>
            <span>{copy.colBattery}</span>
            <span>{copy.colLastSeen}</span>
          </div>
          <div className="ck-rows">
            {devices.map((device) => (
              <button
                key={device.id}
                type="button"
                className={`ck-dtr${selected?.id === device.id ? " on" : ""}`}
                aria-current={selected?.id === device.id ? "true" : undefined}
                onClick={() => setPanel({ kind: "device", id: device.id })}
              >
                <span className="ck-nm">
                  <b>{device.name}</b>
                  <span className={`ck-pill${device.disconnected ? " is-off" : ""}`}>
                    <i aria-hidden="true" />
                    {device.disconnected ? copy.deviceDisconnected : copy.deviceConnected}
                  </span>
                </span>
                <span className="ck-c">{buildingName(device.propertyName)}</span>
                <span className="ck-c">{[device.deviceModel, device.osVersion].filter(Boolean).join(" · ") || "—"}</span>
                <span className="ck-c num">{device.appVersion ?? "—"}</span>
                <span className="ck-c num">{device.battery !== null ? `${device.battery}%` : "—"}</span>
                <span className="ck-c is-soft num">{device.lastSeenAt ? formatTokyoStamp(device.lastSeenAt) : copy.neverSeen}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {panel?.kind === "add" ? (
        <AddPanel
          copy={copy}
          properties={properties}
          onClose={() => {
            setPanel(null);
            refresh();
          }}
          onToast={showToast}
        />
      ) : null}
      {selected ? (
        <DevicePanel
          key={selected.id}
          device={selected}
          copy={copy}
          onClose={() => setPanel(null)}
          onToast={showToast}
          onChanged={refresh}
        />
      ) : null}
      {toast ? <AdminToast key={toast.id} message={toast.message} onDismiss={dismiss} /> : null}
    </div>
  );
}

function AddPanel({
  copy,
  properties,
  onClose,
  onToast,
}: {
  copy: CheckinCopy;
  properties: { key: string; name: string }[];
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const buildingName = useBuildingName();
  const [propertyKey, setPropertyKey] = useState(properties[0]?.key ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: busy });

  useEffect(() => {
    if (!issued) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [issued]);

  async function issue() {
    if (busy || !name.trim() || !propertyKey) return;
    setBusy(true);
    try {
      const result = await issueCheckinEnrollmentCode({ propertyKey, deviceName: name.trim() });
      if (result.ok) {
        haptic("success");
        setNow(Date.now());
        setIssued({ code: result.code, expiresAt: Date.parse(result.expiresAt) });
      } else {
        haptic("error");
        onToast(copy.actionFailed);
      }
    } catch {
      onToast(copy.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function discardCode() {
    if (busy || !issued) return;
    // 다음 발급과 앞뒤가 바뀌면 새 코드가 끝나 버리므로, 끝난 뒤에 발급 단추로 돌아간다. 못 끝냈으면 살아 있는 코드를 화면에서 지우지 않는다.
    setBusy(true);
    try {
      const result = await invalidateCheckinEnrollmentCode(issued.code);
      if (result.ok) {
        haptic("light");
        setIssued(null);
      } else {
        haptic("error");
        onToast(copy.actionFailed);
      }
    } catch {
      haptic("error");
      onToast(copy.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  const remaining = issued ? issued.expiresAt - now : 0;
  const expired = issued !== null && remaining <= 0;

  return (
    <>
      <div className="panel-scrim on" onClick={busy ? undefined : onClose} />
      <aside ref={panelRef} className="panel on ck-panel" role="dialog" aria-label={copy.addTitle} tabIndex={-1}>
        <div className="ck-hd">
          <span className="ck-hd__k">{copy.addTitle}</span>
          <button type="button" className="ck-ic ck-hd__x" aria-label={copy.close} disabled={busy} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="ck-pb">
          <div className="ck-sec">
            <div className="ck-field">
              <span className="ck-lab">{copy.fieldProperty}</span>
              <AdmDropdown
                value={propertyKey}
                onChange={setPropertyKey}
                ariaLabel={copy.fieldProperty}
                disabled={issued !== null}
                wide
                options={properties.map((property) => ({ value: property.key, label: buildingName(property.name) }))}
              />
            </div>
            <div className="ck-field">
              <label htmlFor="ck-device-name">{copy.fieldDeviceName}</label>
              <input
                id="ck-device-name"
                className="ck-in"
                value={name}
                maxLength={60}
                placeholder={copy.deviceNamePlaceholder}
                disabled={issued !== null}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void issue();
                }}
              />
            </div>
          </div>
          {issued ? (
            <div className="ck-sec">
              <span className="ck-k">{copy.registrationCode}</span>
              <div className={`ck-enroll${expired ? " is-old" : ""}`} aria-label={issued.code.split("").join(" ")}>
                {groupEnrollmentCode(issued.code)}
              </div>
              <p className={`ck-soft num${expired ? " is-red" : ""}`} aria-live="polite">
                {expired ? copy.codeExpiredNote : fill(copy.codeRemaining, { time: formatRemaining(remaining) })}
              </p>
              {expired ? null : <p className="ck-soft num">{fill(copy.codeCloseHint, { time: formatRemaining(remaining) })}</p>}
              <ol className="ck-steps">
                <li>{copy.enrollStep1}</li>
                <li>{copy.enrollStep2}</li>
                <li>{copy.enrollStep3}</li>
              </ol>
              {expired ? null : (
                <p className="ck-soft" id="ck-new-code-note">
                  {copy.newCodeNote}
                </p>
              )}
            </div>
          ) : null}
        </div>
        <div className="ck-pf">
          {issued ? (
            <button
              type="button"
              className="ck-btn is-block"
              disabled={busy}
              aria-busy={busy}
              aria-describedby={expired ? undefined : "ck-new-code-note"}
              onClick={() => void discardCode()}
            >
              {copy.newCode}
            </button>
          ) : (
            <button type="button" className="ck-btn is-pri is-block" onClick={() => void issue()} disabled={busy || !name.trim() || !propertyKey} aria-busy={busy}>
              {busy ? copy.issuing : copy.issueCode}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

function DevicePanel({
  device,
  copy,
  onClose,
  onToast,
  onChanged,
}: {
  device: CheckinDevice;
  copy: CheckinCopy;
  onClose: () => void;
  onToast: (message: string) => void;
  onChanged: () => void;
}) {
  const buildingName = useBuildingName();
  const [name, setName] = useState(device.name);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const panelRef = useAdminPanelA11y<HTMLElement>(onClose, { disabled: busy || confirm });
  const cancelConfirm = useCallback(() => setConfirm(false), []);
  const nameChanged = name.trim() !== device.name && name.trim().length > 0;

  async function rename() {
    if (busy || !nameChanged) return;
    setBusy(true);
    try {
      const result = await renameCheckinDevice({ deviceId: device.id, name: name.trim() });
      if (result.ok) {
        haptic("success");
        onToast(copy.deviceRenamed);
        onChanged();
      } else {
        haptic("error");
        onToast(copy.actionFailed);
      }
    } catch {
      onToast(copy.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await revokeCheckinDevice(device.id);
      if (result.ok) {
        haptic("light");
        onToast(copy.deviceRevoked);
        setConfirm(false);
        onChanged();
        onClose();
      } else {
        haptic("error");
        onToast(copy.actionFailed);
      }
    } catch {
      onToast(copy.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string][] = [
    [copy.colProperty, buildingName(device.propertyName)],
    [copy.kvModel, device.deviceModel ?? "—"],
    [copy.kvOs, device.osVersion ?? "—"],
    [copy.kvAppVersion, device.appVersion ?? "—"],
    [copy.kvBattery, device.battery !== null ? `${device.battery}%` : "—"],
    [copy.kvRegistered, formatTokyoStamp(device.registeredAt)],
  ];

  return (
    <>
      <div className="panel-scrim on" onClick={busy ? undefined : onClose} />
      <aside ref={panelRef} className="panel on ck-panel" role="dialog" aria-label={copy.deviceDetailTitle} tabIndex={-1}>
        <div className="ck-hd">
          <span className="ck-hd__k">{copy.deviceDetailTitle}</span>
          <button type="button" className="ck-ic is-danger" aria-label={copy.deviceRevoke} onClick={() => setConfirm(true)} disabled={busy}>
            <Trash2 aria-hidden="true" />
          </button>
          <button type="button" className="ck-ic ck-hd__x" aria-label={copy.close} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="ck-pb">
          <div className="ck-sec is-head">
            <div className="ck-lead">
              <b>{device.name}</b>
            </div>
            {device.disconnected ? (
              <div className="ck-warn" role="note">
                <TriangleAlert aria-hidden="true" />
                <div>
                  <b>{fill(copy.disconnectedTitle, { at: device.lastSeenAt ? formatTokyoStamp(device.lastSeenAt) : copy.neverSeen })}</b>
                  <p>{copy.disconnectedBody}</p>
                </div>
              </div>
            ) : null}
          </div>
          <div className="ck-sec">
            <div className="ck-field">
              <label htmlFor="ck-rename">{copy.deviceRename}</label>
              <div className="ck-rename">
                <input
                  id="ck-rename"
                  className="ck-in"
                  value={name}
                  maxLength={60}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void rename();
                  }}
                />
                <button type="button" className="ck-btn is-sm" onClick={() => void rename()} disabled={busy || !nameChanged}>
                  {copy.save}
                </button>
              </div>
            </div>
          </div>
          <div className="ck-sec">
            <dl className="ck-kv num">
              {rows.map(([label, value]) => (
                <div key={label} style={{ display: "contents" }}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </aside>

      {confirm ? (
        <ConfirmRevoke copy={copy} busy={busy} onCancel={cancelConfirm} onConfirm={() => void revoke()} />
      ) : null}
    </>
  );
}

function ConfirmRevoke({ copy, busy, onCancel, onConfirm }: { copy: CheckinCopy; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  useEffect(() => {
    if (busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onCancel]);
  return (
    <>
      <div className="modal-scrim on ck-scrim" onClick={busy ? undefined : onCancel} />
      <div className="modal on ck-modal" role="alertdialog" aria-modal="true" aria-labelledby="ck-revoke-t" aria-describedby="ck-revoke-b">
        <h2 id="ck-revoke-t">{copy.revokeTitle}</h2>
        <p id="ck-revoke-b">{copy.revokeBody}</p>
        <div className="ck-modal__f">
          {/* 첫 초점은 「그대로 두기」 — Enter 한 번에 폐기되지 않게. */}
          <button type="button" className="ck-btn" disabled={busy} onClick={onCancel} autoFocus>
            {copy.revokeKeep}
          </button>
          <button type="button" className="ck-btn is-danger" disabled={busy} aria-busy={busy} onClick={onConfirm}>
            {copy.revokeDo}
          </button>
        </div>
      </div>
    </>
  );
}
