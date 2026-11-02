package com.harutokyo.checkin.kiosk.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// 기기 토큰 · 마지막 계약을 Android Keystore 키(AES-GCM)로 암호화해 앱 전용 저장소에 둔다(16 §5 data/).
// 키는 기기 밖으로 나가지 않는다. 앱을 지우면 같이 사라진다(다시 등록).
class TokenVault(context: Context) {
    private val prefs = context.getSharedPreferences("kiosk_vault", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    fun put(name: String, value: String?) {
        if (value == null) {
            prefs.edit { remove(name) }
            return
        }
        val cipher = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.iv + cipher.doFinal(value.toByteArray())
        prefs.edit { putString(name, Base64.encodeToString(sealed, Base64.NO_WRAP)) }
    }

    fun get(name: String): String? {
        val stored = prefs.getString(name, null) ?: return null
        return try {
            val sealed = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV_BYTES))
            String(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES))
        } catch (_: Exception) {
            // 키가 바뀌었거나 값이 깨졌으면 없는 것으로 — 다시 등록하면 된다.
            null
        }
    }

    fun clear() = prefs.edit { clear() }

    private companion object {
        const val ALIAS = "checkin_kiosk_vault"
        const val TRANSFORM = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}
