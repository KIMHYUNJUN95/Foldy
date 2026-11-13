package com.harutokyo.checkin.kiosk.contract

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// 서버 계약(apps/checkin/src/lib/contract/schema.ts)과 1:1. 원본은 서버 zod 다 — 바꾸면 CONTRACT_VERSION 을 같이 올린다.
const val CONTRACT_VERSION = 2

@Serializable
data class ContractField(
    val key: String,
    val required: Boolean,
    val foreignOnly: Boolean = false,
    val label: Map<String, String> = emptyMap(),
)

/** 기기별 PIN 값(2026-11-13, 계약 2) — 원 해시가 아니라 HMAC(deviceSalt, PBKDF2 결과). 오프라인 대조에만 쓴다(`Pin.verify`). */
@Serializable
data class StaffPin(
    val algorithm: String,
    val iterations: Int,
    val salt: String,
    val deviceSalt: String,
    val keyBytes: Int = 32,
    val hash: String,
)

@Serializable
data class Contract(
    val contractVersion: Int,
    val languages: List<String>,
    val welcomeText: Map<String, String> = emptyMap(),
    val termsVersion: Int,
    val fields: List<ContractField>,
    val videoSecondsPerGuest: Int,
    val verificationMethod: String,
    val termsText: Map<String, String> = emptyMap(),
    val idleSecondsInput: Int = 240,
    val idleSecondsDone: Int = 30,
    val mrzAutofill: Boolean = true,
    val supportContacts: Map<String, String> = emptyMap(),
    val staffPin: StaffPin? = null,
    /** 건물별 「직원 통화」 켜짐(46). 꺼짐이면 연락처 화면만. */
    val staffCallEnabled: Boolean = false,
)

@Serializable
data class DeviceInfo(
    val id: String,
    val propertyKey: String,
    val name: String,
)

@Serializable
data class SettingsResponse(
    val ok: Boolean,
    val device: DeviceInfo? = null,
    val settingsVersion: String? = null,
    val contract: Contract? = null,
    val error: String? = null,
    @SerialName("contract_version") val contractVersion: Int? = null,
)

@Serializable
data class EnrollResponse(
    val ok: Boolean,
    val token: String? = null,
    val device: DeviceInfo? = null,
    val error: String? = null,
)

@Serializable
data class PingResponse(
    val ok: Boolean,
    val settingsVersion: String? = null,
    val error: String? = null,
)

/** `GET /api/kiosk/settings` 몸 → 결과. 버전을 먼저 보고(모양이 달라 해석이 실패하기 전에), 같을 때만 끝까지 읽는다. */
sealed interface SettingsOutcome {
    data class Ok(val response: SettingsResponse, val contract: Contract) : SettingsOutcome
    /** 서버 계약 버전이 이 앱과 다르다 — 「업데이트 필요」. */
    data object UpdateRequired : SettingsOutcome
    /** 몸이 깨졌거나 실패 응답 — 저장된 설정이 있으면 그대로 쓴다. */
    data object Invalid : SettingsOutcome
}

private val settingsJson = Json { ignoreUnknownKeys = true; explicitNulls = false }

fun settingsOutcomeOf(body: String): SettingsOutcome {
    val version = runCatching {
        settingsJson.parseToJsonElement(body).jsonObject["contract"]?.jsonObject?.get("contractVersion")?.jsonPrimitive?.intOrNull
    }.getOrNull()
    if (version != null && version != CONTRACT_VERSION) return SettingsOutcome.UpdateRequired
    val parsed = runCatching { settingsJson.decodeFromString<SettingsResponse>(body) }.getOrNull()
    val contract = parsed?.contract
    if (parsed?.ok != true || contract == null) return SettingsOutcome.Invalid
    return SettingsOutcome.Ok(parsed, contract)
}

