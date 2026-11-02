package com.harutokyo.checkin.kiosk.data

import com.harutokyo.checkin.kiosk.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

// 서버 호출(apps/checkin `/api/device/*` · `/api/kiosk/*`). 응답 몸은 실패해도 JSON(ok · error) — 그대로 읽는다.
// 네트워크가 없으면 IOException → 화면은 「인터넷 연결 없음」, 저장된 설정으로 계속 동작(FR-K15).
object Api {
    // 찾기 요청(FindQuery)의 종류 칸은 서버 zod 와 같은 "mode".
    val json = Json { ignoreUnknownKeys = true; explicitNulls = false; classDiscriminator = "mode" }

    /** 여권 사진 올리기(multipart: 글 칸들 + JPEG 한 장). */
    suspend fun upload(path: String, token: String, fields: Map<String, String>, fileName: String, jpeg: ByteArray): HttpResult =
        withContext(Dispatchers.IO) {
            val boundary = "kiosk" + System.nanoTime()
            val connection = (URL(BuildConfig.API_BASE + path).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10_000
                readTimeout = 30_000
                doOutput = true
                setRequestProperty("accept", "application/json")
                setRequestProperty("authorization", "Bearer $token")
                setRequestProperty("content-type", "multipart/form-data; boundary=$boundary")
            }
            try {
                connection.outputStream.use { out ->
                    for ((name, value) in fields) {
                        out.write("--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n$value\r\n".toByteArray())
                    }
                    out.write("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$fileName\"\r\nContent-Type: image/jpeg\r\n\r\n".toByteArray())
                    out.write(jpeg)
                    out.write("\r\n--$boundary--\r\n".toByteArray())
                }
                val status = connection.responseCode
                val stream = if (status >= 400) connection.errorStream else connection.inputStream
                HttpResult(status, stream?.bufferedReader()?.use { it.readText() } ?: "")
            } finally {
                connection.disconnect()
            }
        }

    class HttpResult(val status: Int, val body: String)

    suspend fun request(method: String, path: String, token: String?, body: String?): HttpResult =
        withContext(Dispatchers.IO) {
            val connection = (URL(BuildConfig.API_BASE + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("accept", "application/json")
                if (token != null) setRequestProperty("authorization", "Bearer $token")
                if (body != null) {
                    doOutput = true
                    setRequestProperty("content-type", "application/json")
                }
            }
            try {
                if (body != null) connection.outputStream.use { it.write(body.toByteArray()) }
                val status = connection.responseCode
                val stream = if (status >= 400) connection.errorStream else connection.inputStream
                HttpResult(status, stream?.bufferedReader()?.use { it.readText() } ?: "")
            } catch (error: IOException) {
                throw error
            } finally {
                connection.disconnect()
            }
        }
}
