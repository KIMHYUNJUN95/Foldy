package com.harutokyo.checkin.kiosk.kiosk

import android.app.admin.DeviceAdminReceiver

// Device Owner 로 지정될 받는 쪽(정책 없음). 잠금 작업 · 홈 고정 권한의 근거일 뿐이다(16 §5 kiosk/).
class KioskAdminReceiver : DeviceAdminReceiver()
