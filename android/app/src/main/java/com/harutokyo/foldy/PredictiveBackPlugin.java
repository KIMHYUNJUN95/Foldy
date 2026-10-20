package com.harutokyo.foldy;

import androidx.activity.BackEventCompat;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Android 예측 뒤로가기(Predictive Back) → 웹 화면 스와이프 엔진 (2026-10-20, 앱 출시 계획 17번 N12).
 *
 * 시스템 가장자리 제스처는 OS 몫이라 웹이 터치로 받을 수 없다. 대신 OS 가 제스처의 진행(손가락 위치)을 앱에 알려 주는
 * `OnBackPressedCallback` 의 시작 · 진행 · 취소 · 확정을 웹으로 넘긴다 — 웹(`NativeShellBridge`)이 같은 스와이프 엔진으로
 * 지금 화면을 손가락 따라 밀고 아래 이전 화면을 보여 준다. 3버튼 내비게이션의 뒤로 버튼은 확정(`backInvoked`)만 온다.
 *
 * 웹이 「뒤로 갈 곳이 있다」(열린 시트 · 이전 화면 · 위 화면)고 알려 줄 때만(`setEnabled`) 켠다. 꺼져 있으면 OS 기본 동작 —
 * 홈 화면으로 나가는 미리보기 애니메이션. 그래서 Capacitor App 플러그인의 뒤로 처리는 끈다(`capacitor.config.ts`
 * `App.disableBackButtonHandler`) — 켜 두면 늘 가로채서 OS 미리보기가 안 나온다.
 * 문서: docs/product/16-mobile-navigation.md 「뒤로가기 — 화면 스와이프」
 */
@CapacitorPlugin(name = "PredictiveBack")
public class PredictiveBackPlugin extends Plugin {

    private OnBackPressedCallback callback;

    @Override
    public void load() {
        callback = new OnBackPressedCallback(false) {
            @Override
            public void handleOnBackStarted(@NonNull BackEventCompat event) {
                notifyListeners("backStarted", toJs(event));
            }

            @Override
            public void handleOnBackProgressed(@NonNull BackEventCompat event) {
                notifyListeners("backProgressed", toJs(event));
            }

            @Override
            public void handleOnBackCancelled() {
                notifyListeners("backCancelled", new JSObject());
            }

            @Override
            public void handleOnBackPressed() {
                notifyListeners("backInvoked", new JSObject());
            }
        };
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), callback);
    }

    /** 웹이 「뒤로 갈 곳이 있다」고 알릴 때만 켠다. 꺼지면 OS 기본(홈으로 나가는 미리보기). */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> callback.setEnabled(enabled));
        call.resolve();
    }

    /** 손가락 위치는 기기 픽셀 — 웹이 devicePixelRatio 로 나눈다. edge: 0 왼쪽 · 1 오른쪽 · 2 없음(버튼). */
    private static JSObject toJs(BackEventCompat event) {
        JSObject data = new JSObject();
        data.put("touchX", event.getTouchX());
        data.put("touchY", event.getTouchY());
        data.put("progress", event.getProgress());
        data.put("edge", event.getSwipeEdge());
        return data;
    }
}
