package com.harutokyo.checkin.kiosk.call

import com.harutokyo.checkin.kiosk.data.Api
import kotlinx.coroutines.delay
import java.io.IOException

/** `/api/kiosk/call*` 호출(46 §5). 네트워크 오류는 던지지 않고 실패 값으로 돌려준다. */
class HttpCallApi(private val token: () -> String?) : CallApi {
    override suspend fun create(step: String, language: String, sessionId: String?, nowMs: Long): CreateResult {
        val t = token() ?: return CreateResult.Rejected("unauthorized")
        return try {
            val r = Api.request("POST", "/api/kiosk/call", t, CallWire.createBody(step, language, sessionId))
            CallWire.parseCreate(r.status, r.body, nowMs)
        } catch (_: IOException) {
            CreateResult.Rejected("network")
        }
    }

    override suspend fun status(callId: String): PollStatus? {
        val t = token() ?: return null
        return try {
            val r = Api.request("GET", "/api/kiosk/call/$callId", t, null)
            CallWire.parsePoll(r.status, r.body)
        } catch (_: IOException) {
            null
        }
    }

    override suspend fun cancel(callId: String) = post("/api/kiosk/call/$callId/cancel")
    override suspend fun end(callId: String) = post("/api/kiosk/call/$callId/end")

    // 직원 화면에서 울림이 멈추도록 — 한 번 실패하면 잠시 뒤 한 번 더. 그래도 안 되면 서버가 45초 · 30분 뒤 스스로 닫는다(46 §3).
    private suspend fun post(path: String) {
        val t = token() ?: return
        repeat(2) { attempt ->
            try {
                val r = Api.request("POST", path, t, "{}")
                if (r.status < 500) return
            } catch (_: IOException) {
            }
            if (attempt == 0) delay(1_000)
        }
    }
}
