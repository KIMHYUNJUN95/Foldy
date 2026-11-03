package com.harutokyo.checkin.kiosk.contract

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// 예약 찾기 · 명부(apps/checkin `/api/kiosk/find` · `/api/kiosk/party`)와 1:1. 시안 T1 · T1k · T1x · T1b · T1c · T2.

@Serializable
data class KioskGuest(
    val id: String,
    val name: String? = null,
    val isRepresentative: Boolean = false,
    val isChild: Boolean = false,
    val hasPassportPhoto: Boolean = false,
    val missing: List<String> = emptyList(),
    val hasJapanAddress: Boolean = false,
    /** 대표자만 — 확인 화면(T3c)에 주소를 미리 채운다. */
    val address: String? = null,
    /** 대표자만 — 연락처를 미리 채운다. */
    val contact: String? = null,
    /** 얼굴 영상(5초)이 이미 올라가 있다 — 있으면 빠른 체크인에서 얼굴 찍기를 건너뛴다. */
    val hasFaceVideo: Boolean = false,
)

@Serializable
data class KioskStay(
    val stayId: String,
    val rooms: List<String> = emptyList(),
    val checkInDate: String,
    val checkOutDate: String,
    val nights: Int,
    val partySize: Int,
    val guestCountExpected: Int,
    val consented: Boolean = false,
    val guests: List<KioskGuest> = emptyList(),
)

@Serializable
data class FindResponse(
    val ok: Boolean,
    val result: String? = null,
    @SerialName("session_id") val sessionId: String? = null,
    val language: String? = null,
    val stay: KioskStay? = null,
    val error: String? = null,
    val reason: String? = null,
    val remaining: Int? = null,
    @SerialName("locked_until") val lockedUntil: String? = null,
    @SerialName("check_in_date") val checkInDate: String? = null,
)

@Serializable
data class PartyResponse(val ok: Boolean, val stay: KioskStay? = null, val error: String? = null)

@Serializable
sealed interface FindQuery

@Serializable
@SerialName("code")
data class CodeQuery(val code: String) : FindQuery

@Serializable
@SerialName("name")
data class NameQuery(val lastName: String, val firstName: String, val checkInDate: String) : FindQuery

/** 여권 MRZ 의 성 · 이름으로 오늘 예약 찾기(빠른 체크인 F1). 이름은 비어 있을 수 있다. 몸통: {"mode":"passport","lastName":…,"firstName":…} */
@Serializable
@SerialName("passport")
data class PassportQuery(val lastName: String, val firstName: String) : FindQuery

/** 찾기 결과 — 화면이 갈 곳을 정한다. */
sealed interface FindResult {
    data class Found(val sessionId: String, val stay: KioskStay, val language: String?, val checkedIn: Boolean) : FindResult
    data class NotFound(val remaining: Int) : FindResult
    data class Locked(val untilMillis: Long) : FindResult
    data class Blocked(val reason: BlockReason, val checkInDate: String?) : FindResult
    data object Network : FindResult
    data object Server : FindResult
}

enum class BlockReason { TooEarly, Expired, Cancelled, OtherBuilding, Busy }

/** 서버 응답 → 결과. 테스트로 덮는다(HTTP 없음). */
fun findResultOf(response: FindResponse?): FindResult {
    if (response == null) return FindResult.Server
    if (response.ok && response.sessionId != null && response.stay != null) {
        return FindResult.Found(response.sessionId, response.stay, response.language, response.result == "checked_in")
    }
    return when (response.error) {
        "not_found" -> FindResult.NotFound(response.remaining ?: 0)
        "locked" -> FindResult.Locked(response.lockedUntil?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() } ?: (System.currentTimeMillis() + 60_000))
        "blocked" -> FindResult.Blocked(
            when (response.reason) {
                "too_early" -> BlockReason.TooEarly
                "cancelled" -> BlockReason.Cancelled
                "other_building" -> BlockReason.OtherBuilding
                "busy" -> BlockReason.Busy
                else -> BlockReason.Expired
            },
            response.checkInDate,
        )
        else -> FindResult.Server
    }
}
