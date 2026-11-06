package com.harutokyo.checkin.kiosk.camera

import android.os.SystemClock
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

// 얼굴 영상 녹화(빠른 체크인 F4). 미리보기 + 영상만 묶는다(소리 없음 · RECORD_AUDIO 권한 없음).
// 낮은 화질(SD) + 낮은 비트레이트로 5초에 약 1MB — 서버 본문 상한 4MB 안(data/UploadQueue.kt MAX_FACE_BYTES).
// 앞면 카메라를 먼저 쓰는 규칙은 PassportPreview 와 같다. 전면 미리보기는 셀카처럼 거울로 보인다 — 뒤집지 않는다.

const val FACE_SECONDS = 5
private const val FACE_BITRATE = 1_500_000

/**
 * active 가 true 가 되면 durationMs 동안 녹화하고 끝나면 onRecorded(파일). 카메라 · 녹화가 실패하면 onFailed.
 * onProgress 는 0..1(막대용), onRecording 은 실제로 녹화가 시작된 순간.
 */
@Composable
fun FaceRecorder(
    modifier: Modifier,
    active: Boolean,
    durationMs: Long = FACE_SECONDS * 1000L,
    onProgress: (Float) -> Unit,
    onRecording: () -> Unit,
    onRecorded: (File) -> Unit,
    onFailed: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember {
        PreviewView(context).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
    }
    var video by remember { mutableStateOf<VideoCapture<Recorder>?>(null) }
    val progress by rememberUpdatedState(onProgress)
    val recordingCallback by rememberUpdatedState(onRecording)
    val recorded by rememberUpdatedState(onRecorded)
    val failed by rememberUpdatedState(onFailed)
    val disposed = remember { AtomicBoolean(false) }

    // 직원 통화 중에는 카메라를 닫는다. 녹화 중이었다면 그 영상은 버려지고, 돌아오면 처음부터 다시 5초.
    val hold = LocalCameraHold.current
    DisposableEffect(lifecycleOwner, hold) {
        if (hold) return@DisposableEffect onDispose { }
        disposed.set(false)
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        var bound: Array<UseCase> = emptyArray()
        val main = ContextCompat.getMainExecutor(context)
        future.addListener({
            if (disposed.get()) return@addListener
            val camera = runCatching { future.get() }.getOrNull()
            if (camera == null) {
                failed()
                return@addListener
            }
            provider = camera
            val front = runCatching { camera.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) }.getOrDefault(false)
            val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            val recorder = Recorder.Builder()
                .setQualitySelector(QualitySelector.from(Quality.SD, FallbackStrategy.lowerQualityOrHigherThan(Quality.SD)))
                .setTargetVideoEncodingBitRate(FACE_BITRATE)
                .build()
            val capture = VideoCapture.withOutput(recorder)
            val result = runCatching { camera.bindToLifecycle(lifecycleOwner, selector, preview, capture) }
            if (result.isFailure) {
                failed()
            } else {
                bound = arrayOf(preview, capture)
                video = capture
            }
        }, main)
        onDispose {
            // 화면이 사라진 뒤엔 Finalize 가 와도 파일을 넘기지 않는다(아래 handler 가 지운다).
            disposed.set(true)
            video = null
            // 내가 붙인 것만 뗀다 — unbindAll 은 다음 화면이 막 붙인 카메라까지 죽인다.
            if (bound.isNotEmpty()) provider?.unbind(*bound)
        }
    }

    // 카메라가 붙고 active 이면 녹화 시작 → durationMs 뒤 멈춤 → Finalize 에서 파일을 넘긴다.
    LaunchedEffect(video, active) {
        val capture = video ?: return@LaunchedEffect
        if (!active) return@LaunchedEffect
        val file = File.createTempFile("face-", ".mp4", context.cacheDir)
        var recording: Recording? = null
        // 화면을 떠나 취소되면 뒤늦게 오는 Finalize 는 무시하고 파일을 지운다.
        var abandoned = false
        try {
            recording = capture.output
                .prepareRecording(context, FileOutputOptions.Builder(file).build())
                .start(ContextCompat.getMainExecutor(context)) { event ->
                    if (abandoned || disposed.get()) {
                        if (event is VideoRecordEvent.Finalize) file.delete()
                        return@start
                    }
                    if (event is VideoRecordEvent.Start) recordingCallback()
                    if (event is VideoRecordEvent.Finalize) {
                        if (event.hasError()) {
                            file.delete()
                            failed()
                        } else {
                            recorded(file)
                        }
                    }
                }
            val started = SystemClock.elapsedRealtime()
            while (true) {
                val elapsed = SystemClock.elapsedRealtime() - started
                progress((elapsed.toFloat() / durationMs).coerceIn(0f, 1f))
                if (elapsed >= durationMs) break
                delay(50)
            }
            recording.stop()
        } catch (error: Exception) {
            abandoned = true
            recording?.stop()
            file.delete()
            if (error is CancellationException) throw error
            failed()
        }
    }
    AndroidView({ previewView }, modifier)
}
