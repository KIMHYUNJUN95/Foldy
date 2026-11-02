package com.harutokyo.checkin.kiosk.contract

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// 명부 저장(apps/checkin `/api/kiosk/guests` · `/api/kiosk/passport` · `/api/kiosk/route` · `/api/kiosk/consent`)과 1:1. 시안 T3c · T3n · T3s · G3b.

@Serializable
data class MrzPayload(val raw: String, val valid: Boolean)

/** 여권 없이 적는 이유(T3n). child 만 어린이, 나머지 둘은 직원 확인 필요(FR-K16). japan_resident 는 일본 주소로 적는 분. */
enum class NoPassport(val code: String) { Child("child"), JapanResident("japan_resident"), NotShown("not_shown"), CameraOff("camera_off") }

@Serializable
data class GuestInput(
    val id: String? = null,
    val lastName: String,
    val firstName: String,
    val guestType: String = "adult",
    val hasJapanAddress: Boolean = false,
    val nationality: String? = null,
    val passportNumber: String? = null,
    /** 만 나이(0..130). 생년월일은 보내지 않는다 — 명부엔 나이만. */
    val age: Int? = null,
    val gender: String? = null,
    val address: String? = null,
    /** 전화나 이메일 하나 — 대표자만 보낸다(동행자는 대표자 값을 쓴다). */
    val contact: String? = null,
    val noPassportReason: String? = null,
    val mrz: MrzPayload? = null,
)

@Serializable
data class SaveGuestBody(val sessionId: String, val guest: GuestInput)

@Serializable
data class ConsentBody(val sessionId: String, val terms: Boolean, val locale: String)

@Serializable
data class RouteBody(val sessionId: String, val prevStay: String, val nextDest: String)

@Serializable
data class SaveResponse(
    val ok: Boolean,
    @SerialName("guest_id") val guestId: String? = null,
    val stay: KioskStay? = null,
    val error: String? = null,
    val fields: List<String> = emptyList(),
)

/** 저장 결과 — 화면이 갈 곳을 정한다. */
sealed interface SaveResult {
    data class Saved(val guestId: String?, val stay: KioskStay) : SaveResult
    data class Invalid(val fields: List<String>) : SaveResult
    data object SessionGone : SaveResult
    data object Failed : SaveResult
}

fun saveResultOf(status: Int, response: SaveResponse?): SaveResult = when {
    response?.ok == true && response.stay != null -> SaveResult.Saved(response.guestId, response.stay)
    response?.error == "invalid" -> SaveResult.Invalid(response.fields)
    status == 409 && response?.error == "session_gone" -> SaveResult.SessionGone
    else -> SaveResult.Failed
}

/** 전 숙박지 · 다음 행선지 값 — apps/checkin `src/lib/guest/route.ts` 와 같은 값(바꾸면 둘 다). */
object RouteValue {
    const val ARRIVED_TODAY = "当日入国"
    const val LEAVING_JAPAN = "出国"
    val CITIES = linkedMapOf("tokyo" to "東京", "osaka" to "大阪", "kyoto" to "京都", "fukuoka" to "福岡")
    const val TEXT_MAX = 60

    /** border = 국경(오늘 도착 / 일본 떠남), city = 고른 도시 키, other = 직접 쓴 글. 빈 글이면 null. */
    fun of(prev: Boolean, border: Boolean, city: String?, other: String): String? = when {
        border -> if (prev) ARRIVED_TODAY else LEAVING_JAPAN
        city != null -> CITIES[city]
        else -> other.replace(Regex("\\s+"), " ").trim().take(TEXT_MAX).ifEmpty { null }
    }
}
