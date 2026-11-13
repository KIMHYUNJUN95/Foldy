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

/**
 * 여권 MRZ 로 오늘 예약 찾기(빠른 체크인 F1). 이름은 비어 있을 수 있다. 몸통: {"mode":"passport","lastName":…,"firstName":…,"mrz_raw":…}
 * 서버는 `mrz_raw`(두 줄을 \n 으로 이은 원문, prove 와 같은 값)를 직접 읽어 검사 숫자 · 이름 · 명부 여권 번호를 확인한다 — 이름 칸은 참고용(2026-11-13).
 */
@Serializable
@SerialName("passport")
data class PassportQuery(val lastName: String, val firstName: String, @SerialName("mrz_raw") val mrzRaw: String? = null) : FindQuery

/** 찾기 결과 — 화면이 갈 곳을 정한다. */
sealed interface FindResult {
    data class Found(val sessionId: String, val stay: KioskStay, val language: String?, val checkedIn: Boolean) : FindResult
    /** 이름으로 찾았다 — 예약하신 분의 여권을 비춰 이름이 맞아야 예약 내용을 보여 준다(prove). 예약 내용은 아직 없다. */
    data class ProofNeeded(val sessionId: String, val language: String?) : FindResult
    data class NotFound(val remaining: Int) : FindResult
    data class Locked(val untilMillis: Long) : FindResult
    data class Blocked(val reason: BlockReason, val checkInDate: String?) : FindResult
    /** 여권 번호가 명부와 다르다 — 직원 확인이 필요하다(직원 호출 창으로). 이유는 손님에게 보이지 않는다. */
    data object StaffNeeded : FindResult
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
    if (response.ok && response.result == "proof_needed" && response.sessionId != null) return FindResult.ProofNeeded(response.sessionId, response.language)
    return when (response.error) {
        "not_found" -> FindResult.NotFound(response.remaining ?: 0)
        "staff_needed" -> FindResult.StaffNeeded
        "locked" -> FindResult.Locked(lockedUntilOf(response.lockedUntil))
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

/** 잠금 해제 시각(서버가 ISO 로 준다). 못 읽으면 1분 뒤. */
fun lockedUntilOf(value: String?): Long =
    value?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() } ?: (System.currentTimeMillis() + 60_000)

/** 예약하신 분 여권 확인(`POST /api/kiosk/prove`) 몸통 — mrz_raw 는 두 줄을 \n 으로 이은 원문. */
@Serializable
data class ProveBody(@SerialName("session_id") val sessionId: String, @SerialName("mrz_raw") val mrzRaw: String)

sealed interface ProveResult {
    /** 이름이 맞다 — 찾기 성공과 같은 모양(found / checked_in). */
    data class Matched(val found: FindResult.Found) : ProveResult
    data object Unreadable : ProveResult
    data object NameMismatch : ProveResult
    /** 명부 여권 번호와 다른 여권 — 직원 호출로. */
    data object StaffNeeded : ProveResult

    /** 예약이 닫혔다(session_gone) — 처음으로. */
    data object SessionGone : ProveResult

    /** 취소 · 기간 지남 · 사용 중(busy) 등 — 기존 막힘 화면. */
    data class Blocked(val blocked: FindResult.Blocked) : ProveResult
    data class Locked(val untilMillis: Long) : ProveResult
    data object Network : ProveResult
    data object Server : ProveResult
}

/** 서버 응답 → 결과. 테스트로 덮는다. verify_required 같은 나머지는 일반 오류. */
fun proveResultOf(status: Int, response: FindResponse?): ProveResult {
    if (response == null) return ProveResult.Server
    val found = findResultOf(response)
    if (found is FindResult.Found) return ProveResult.Matched(found)
    if (found is FindResult.Blocked) return ProveResult.Blocked(found)
    return when {
        status == 409 && response.error == "session_gone" -> ProveResult.SessionGone
        status == 400 && response.error == "unreadable" -> ProveResult.Unreadable
        status == 403 && response.error == "name_mismatch" -> ProveResult.NameMismatch
        status == 403 && response.error == "staff_needed" -> ProveResult.StaffNeeded
        status == 429 && response.error == "locked" -> ProveResult.Locked(lockedUntilOf(response.lockedUntil))
        else -> ProveResult.Server
    }
}
