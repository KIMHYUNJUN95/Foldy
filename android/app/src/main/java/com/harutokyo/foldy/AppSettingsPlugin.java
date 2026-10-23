package com.harutokyo.foldy;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 이 앱의 「앱 정보」 설정 화면 열기 (2026-10-23, docs/product/41 §10).
 *
 * 카메라 권한을 「다시 묻지 않음」으로 거부하면 WebView 의 getUserMedia 는 묻지도 않고 바로 실패한다 — 사용자가 직접
 * 설정에서 켜야 한다. 웹(`src/lib/native/app-settings.ts`)이 「설정 열기」 버튼에서 부른다. iOS 는 플러그인 없이
 * `app-settings:` 주소로 연다(Capacitor 가 앱 밖 주소를 OS 로 넘긴다).
 * 이 플러그인이 없는 옛 앱 빌드에서는 웹이 버튼을 그리지 않는다(`hasNativePlugin("AppSettings")`).
 */
@CapacitorPlugin(name = "AppSettings")
public class AppSettingsPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Settings screen unavailable.");
        }
    }
}
