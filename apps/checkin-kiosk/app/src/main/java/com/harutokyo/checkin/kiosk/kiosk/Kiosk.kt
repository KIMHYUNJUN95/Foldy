package com.harutokyo.checkin.kiosk.kiosk

import android.app.Activity
import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import com.harutokyo.checkin.kiosk.MainActivity

// 키오스크 잠금(FR-D02). Device Owner 일 때만 완전 잠금 — 홈 · 최근 앱 · 알림 · 상태바를 막고, 이 앱을 홈으로 고정한다.
// Device Owner 가 아니면(개발 중 에뮬레이터 등) 잠그지 않는다. 화면 고정 확인 창이 손님에게 뜨면 안 되기 때문.
object Kiosk {
    private fun admin(context: Context) = ComponentName(context, KioskAdminReceiver::class.java)

    private fun dpm(context: Context) = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager

    fun isDeviceOwner(context: Context): Boolean = dpm(context).isDeviceOwnerApp(context.packageName)

    fun isLocked(context: Context): Boolean {
        val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        return manager.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE
    }

    fun lock(activity: Activity) {
        if (!isDeviceOwner(activity) || isLocked(activity)) return
        val dpm = dpm(activity)
        val admin = admin(activity)
        dpm.setLockTaskPackages(admin, arrayOf(activity.packageName))
        // 잠긴 동안 상태바 · 알림 · 홈 · 최근 앱 모두 막음(기본값 0 = 아무것도 허용 안 함).
        dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
        dpm.addPersistentPreferredActivity(
            admin,
            IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            },
            ComponentName(activity, MainActivity::class.java),
        )
        activity.startLockTask()
    }

    /** 직원 메뉴 「잠금 풀기」 — 설정 앱 · 재시작이 필요할 때. 다시 잠그거나 앱을 다시 열면 잠긴다. */
    fun unlock(activity: Activity) {
        if (isLocked(activity)) activity.stopLockTask()
    }
}
