package com.harutokyo.checkin.kiosk.kiosk

import com.harutokyo.checkin.kiosk.contract.StaffPin
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

// 직원 해제 PIN 대조(FR-K18) — 서버 apps/checkin/src/lib/device/pin.ts 와 같은 PBKDF2-SHA256.
// 계약으로 받은 해시만 쓰므로 오프라인에서도 된다. PIN 원문은 저장하지 않는다.
object Pin {
    private val shape = Regex("^[0-9]{4,8}$")

    fun verify(pin: String, stored: StaffPin?): Boolean {
        if (stored == null || stored.algorithm != "pbkdf2-sha256" || !shape.matches(pin)) return false
        return try {
            val salt = Base64.getDecoder().decode(stored.salt)
            val expected = Base64.getDecoder().decode(stored.hash)
            val spec = PBEKeySpec(pin.toCharArray(), salt, stored.iterations, expected.size * 8)
            val given = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            MessageDigest.isEqual(given, expected)
        } catch (_: IllegalArgumentException) {
            false
        }
    }
}
