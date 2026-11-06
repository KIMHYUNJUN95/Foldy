package com.harutokyo.checkin.kiosk.contract

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// 서버 계약(apps/checkin/src/lib/contract/schema.ts)과 1:1. 원본은 서버 zod 다 — 바꾸면 CONTRACT_VERSION 을 같이 올린다.
const val CONTRACT_VERSION = 1

@Serializable
data class ContractField(
    val key: String,
    val required: Boolean,
    val foreignOnly: Boolean = false,
    val label: Map<String, String> = emptyMap(),
)

@Serializable
data class StaffPin(
    val algorithm: String,
    val iterations: Int,
    val salt: String,
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
