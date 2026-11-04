package com.harutokyo.checkin.kiosk.contract

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// 체크인 완료(apps/checkin `POST /api/kiosk/complete`)와 1:1. 시안 G4. 문 비밀번호 같은 값이 들어 있어 로그로 남기지 않는다.

@Serializable
data class CompleteBody(@SerialName("session_id") val sessionId: String)

@Serializable
data class CompleteRoom(
    val label: String = "",
    val code: String? = null,
    /** true 면 label 은 방 번호가 아니라 한국어 건물 이름(예: 오쿠보A) — 데이터라 그대로 그리지 않는다. */
    @SerialName("unit_name") val unitName: Boolean = false,
)

@Serializable
data class CompleteShared(
    @SerialName("label_key") val labelKey: String = "",
    val code: String = "",
    @SerialName("prefix_key") val prefixKey: String? = null,
    @SerialName("note_key") val noteKey: String? = null,
)

@Serializable
data class CompleteAddress(val ko: String? = null, val ja: String? = null, val en: String? = null)

@Serializable
data class CompleteResponse(
    val ok: Boolean,
    val already: Boolean = false,
    val rooms: List<CompleteRoom> = emptyList(),
    val shared: List<CompleteShared> = emptyList(),
    val address: CompleteAddress? = null,
    @SerialName("check_in_date") val checkInDate: String? = null,
    @SerialName("check_out_date") val checkOutDate: String? = null,
    @SerialName("guest_count") val guestCount: Int = 0,
    @SerialName("lead_name") val leadName: String? = null,
    @SerialName("staff_check_count") val staffCheckCount: Int = 0,
    val error: String? = null,
    val reason: String? = null,
)

/** 완료 화면이 그리는 값. 비밀번호가 들어 있으니 toString 에 값을 싣지 않는다. */
data class CompletionInfo(
    val rooms: List<CompleteRoom>,
    val shared: List<CompleteShared>,
    val address: CompleteAddress?,
    val checkInDate: String?,
    val checkOutDate: String?,
    val guestCount: Int,
    val leadName: String?,
    val staffCheckCount: Int,
) {
    override fun toString(): String = "CompletionInfo(rooms=${rooms.size}, shared=${shared.size})"
}

sealed interface CompleteResult {
    data class Done(val info: CompletionInfo) : CompleteResult

    /** 아직 덜 됨(consent = 동의 안 함, roster = 명부 부족) — 직원이 도와야 한다. */
    data class Incomplete(val reason: String?) : CompleteResult
    data object SessionGone : CompleteResult

    /** 403 verify_required — 이름으로 찾은 예약은 더 강한 확인(예약 코드 · 여권)이 필요하다. 다시 시도해도 같다. */
    data object VerifyRequired : CompleteResult

    /** 409 blocked — 취소됐거나(cancelled) 기간이 지난(expired) 예약. 다시 시도해도 같다. */
    data class Blocked(val reason: String?) : CompleteResult
    data object Network : CompleteResult
    data object Server : CompleteResult
}

/** 서버 응답 → 결과. 테스트로 덮는다(HTTP 없음). */
fun completeResultOf(status: Int, response: CompleteResponse?): CompleteResult = when {
    response?.ok == true -> CompleteResult.Done(
        CompletionInfo(
            rooms = response.rooms.filter { it.label.isNotBlank() },
            shared = response.shared.filter { it.code.isNotBlank() },
            address = response.address,
            checkInDate = response.checkInDate,
            checkOutDate = response.checkOutDate,
            guestCount = response.guestCount,
            leadName = response.leadName?.takeIf { it.isNotBlank() },
            staffCheckCount = response.staffCheckCount,
        ),
    )
    status == 409 && response?.error == "incomplete" -> CompleteResult.Incomplete(response.reason)
    status == 409 && response?.error == "session_gone" -> CompleteResult.SessionGone
    status == 403 && response?.error == "verify_required" -> CompleteResult.VerifyRequired
    status == 409 && response?.error == "blocked" -> CompleteResult.Blocked(response.reason)
    else -> CompleteResult.Server
}

/** 공용 비밀번호 이름 — 서버가 주는 label_key(doorPassword · roomPassword · keyBox · keyBoxPassword)를 화면 문구 종류로. 모르는 키(창고 계열 포함)는 Generic — 원문은 절대 안 그린다. */
enum class AccessKind { DoorPassword, RoomPassword, KeyBox, KeyBoxPassword, Generic }

fun accessKindOf(labelKey: String): AccessKind = when (labelKey) {
    "doorPassword" -> AccessKind.DoorPassword
    "roomPassword" -> AccessKind.RoomPassword
    "keyBox" -> AccessKind.KeyBox
    "keyBoxPassword" -> AccessKind.KeyBoxPassword
    else -> AccessKind.Generic
}

/** 앞붙이(1층) — 아는 키만. 모르면 false(그리지 않음). */
fun isFirstFloorPrefix(prefixKey: String?): Boolean = prefixKey == "floor1"

/** 덧말(모든 방 같음) — 아는 키만. */
fun isAllRoomsSameNote(noteKey: String?): Boolean = noteKey == "allRoomsSame"

/** 문패에 그릴 글자. 건물 이름(unit_name)은 한국어일 때만 그대로 — 다른 언어는 번역 데이터가 태블릿에 없어 문패를 그리지 않는다(null). */
fun signLabelOf(room: CompleteRoom, language: String): String? = when {
    room.label.isBlank() -> null
    !room.unitName -> room.label
    language == "ko" -> room.label
    else -> null
}

/** 비밀번호 글자 크기(sp) — 길수록 줄여 칸을 넘지 않게. [big] 은 공용 줄(넓은 칸). */
fun codeTextSize(length: Int, big: Boolean): Int = if (big) {
    when {
        length <= 10 -> 40
        length <= 16 -> 32
        else -> 26
    }
} else {
    when {
        length <= 6 -> 64
        length <= 8 -> 48
        length <= 12 -> 34
        else -> 26
    }
}

/** 주소는 손님 언어로(ko · ja · en). 중국어는 영어, 그 언어 주소가 비면 영어 → 일본어 → 한국어 순. 없으면 null. */
fun addressFor(address: CompleteAddress?, language: String): String? {
    if (address == null) return null
    val own = when (language) {
        "ko" -> address.ko
        "ja" -> address.ja
        else -> address.en
    }
    return listOf(own, address.en, address.ja, address.ko).firstNotNullOfOrNull { it?.trim()?.takeIf(String::isNotEmpty) }
}

/** 방 비밀번호 없는 방이 있는데 공용 비밀번호도 공용 비밀번호도 없을 때만 「직원에게」 안내를 보인다. */
fun needsStaffForCode(info: CompletionInfo): Boolean =
    info.shared.isEmpty() && (info.rooms.isEmpty() || info.rooms.any { it.code.isNullOrBlank() })
