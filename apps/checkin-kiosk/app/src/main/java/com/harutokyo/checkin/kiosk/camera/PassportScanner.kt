package com.harutokyo.checkin.kiosk.camera

import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.graphics.scale
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.harutokyo.checkin.kiosk.mrz.Mrz
import com.harutokyo.checkin.kiosk.mrz.MrzResult
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

// 여권 카메라(시안 T3). 미리보기 · 글자 읽기(ImageAnalysis + ML Kit) · 찍기(ImageCapture) 셋을 한 번에 묶는다.
// 같은 여권 번호가 STEADY_MS 동안 이어서 읽히면 저절로 찍는다 — 손님이 버튼을 찾지 않게(16 §1-0 ②).
// 전면 카메라를 먼저 쓴다(키오스크는 화면 위쪽 카메라를 손님이 본다). 미리보기는 거울처럼 뒤집지 않는다 — 글자가 바로 보여야
// 맞췄는지 안다(시안 메모 · 기기에서 확인할 것).

enum class ScanPhase { Starting, Searching, Holding, Capturing }

class ScanUpdate(val phase: ScanPhase, val progress: Float = 0f)

/** 찍은 사진 + (읽었으면) MRZ. 사진은 긴 변 2,400px JPEG(서버 상한 안 · 16 §6). */
class Captured(val jpeg: ByteArray, val mrz: MrzResult?)

class PassportScanner {
    internal var capture: ImageCapture? = null
    internal val analysisExecutor = Executors.newSingleThreadExecutor()
    internal val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    internal var lastNumber: String? = null
    internal var since = 0L
    internal var fired = false
    internal var lastMrz: MrzResult? = null

    /** 「직접 찍기」 — 지금 장면을 찍고, 사진에서 다시 읽는다. */
    suspend fun shoot(): Captured? {
        fired = true
        val bitmap = takeBitmap() ?: return null
        val mrz = lastMrz ?: read(bitmap)
        return Captured(jpegOf(bitmap), mrz)
    }

    internal suspend fun takeBitmap(): Bitmap? {
        val use = capture ?: return null
        return suspendCancellableCoroutine { continuation ->
            use.takePicture(
                analysisExecutor,
                object : ImageCapture.OnImageCapturedCallback() {
                    override fun onCaptureSuccess(image: ImageProxy) {
                        val bitmap = image.toBitmap().rotated(image.imageInfo.rotationDegrees)
                        image.close()
                        continuation.resume(bitmap)
                    }

                    override fun onError(exception: ImageCaptureException) {
                        continuation.resume(null)
                    }
                },
            )
        }
    }

    private suspend fun read(bitmap: Bitmap): MrzResult? = suspendCancellableCoroutine { continuation ->
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { continuation.resume(Mrz.parse(it.text)) }
            .addOnFailureListener { continuation.resume(null) }
    }

    fun close() {
        recognizer.close()
        analysisExecutor.shutdown()
    }

    companion object {
        const val STEADY_MS = 800L
        private const val MAX_EDGE = 2400

        internal fun Bitmap.rotated(degrees: Int): Bitmap =
            if (degrees == 0) this else Bitmap.createBitmap(this, 0, 0, width, height, Matrix().apply { postRotate(degrees.toFloat()) }, true)

        fun jpegOf(bitmap: Bitmap): ByteArray {
            val scale = minOf(1f, MAX_EDGE.toFloat() / maxOf(bitmap.width, bitmap.height))
            val sized = if (scale < 1f) bitmap.scale((bitmap.width * scale).toInt(), (bitmap.height * scale).toInt()) else bitmap
            return ByteArrayOutputStream().use { out ->
                sized.compress(Bitmap.CompressFormat.JPEG, 88, out)
                out.toByteArray()
            }
        }
    }
}

/** 카메라 미리보기. 카메라를 못 열면 onUnavailable(→ T3n 「카메라가 켜지지 않아요」). */
@Composable
fun PassportPreview(
    scanner: PassportScanner,
    modifier: Modifier,
    onUpdate: (ScanUpdate) -> Unit,
    onCaptured: (Captured) -> Unit,
    onUnavailable: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember {
        PreviewView(context).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
    }
    DisposableEffect(lifecycleOwner) {
        val future = ProcessCameraProvider.getInstance(context)
        var provider: ProcessCameraProvider? = null
        val main = ContextCompat.getMainExecutor(context)
        future.addListener({
            val camera = runCatching { future.get() }.getOrNull()
            if (camera == null) {
                onUnavailable()
                return@addListener
            }
            provider = camera
            val front = runCatching { camera.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) }.getOrDefault(false)
            val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
            // 전면 미리보기는 PreviewView 가 거울로 뒤집는다 — 한 번 더 뒤집어 글자가 바로 보이게.
            previewView.scaleX = if (front) -1f else 1f
            val resolution = ResolutionSelector.Builder()
                .setResolutionStrategy(ResolutionStrategy(Size(1920, 1080), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                .build()
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            val capture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .setResolutionSelector(resolution)
                .build()
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setResolutionSelector(resolution)
                .build()
            scanner.capture = capture
            scanner.fired = false
            analysis.setAnalyzer(scanner.analysisExecutor) { image -> analyze(scanner, image, main, onUpdate, onCaptured) }
            val bound = runCatching {
                camera.unbindAll()
                camera.bindToLifecycle(lifecycleOwner, selector, preview, capture, analysis)
            }
            if (bound.isFailure) onUnavailable() else main.execute { onUpdate(ScanUpdate(ScanPhase.Searching)) }
        }, main)
        onDispose {
            provider?.unbindAll()
            scanner.capture = null
        }
    }
    AndroidView({ previewView }, modifier)
}

@androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
private fun analyze(
    scanner: PassportScanner,
    image: ImageProxy,
    main: java.util.concurrent.Executor,
    onUpdate: (ScanUpdate) -> Unit,
    onCaptured: (Captured) -> Unit,
) {
    val media = image.image
    if (media == null || scanner.fired) {
        image.close()
        return
    }
    scanner.recognizer.process(InputImage.fromMediaImage(media, image.imageInfo.rotationDegrees))
        .addOnSuccessListener { text ->
            val mrz = Mrz.parse(text.text)
            val now = System.currentTimeMillis()
            if (mrz == null) {
                scanner.lastNumber = null
                main.execute { if (!scanner.fired) onUpdate(ScanUpdate(ScanPhase.Searching)) }
                return@addOnSuccessListener
            }
            if (mrz.documentNumber != scanner.lastNumber) {
                scanner.lastNumber = mrz.documentNumber
                scanner.since = now
            }
            // 검사 숫자가 다 맞는 쪽을 남긴다(같은 여권을 여러 장 읽는 동안).
            if (scanner.lastMrz?.documentNumber != mrz.documentNumber || mrz.valid) scanner.lastMrz = mrz
            val held = now - scanner.since
            if (held >= PassportScanner.STEADY_MS && !scanner.fired) {
                scanner.fired = true
                main.execute { onUpdate(ScanUpdate(ScanPhase.Capturing, 1f)) }
                Thread {
                    val bitmap = kotlinx.coroutines.runBlocking { scanner.takeBitmap() }
                    main.execute {
                        if (bitmap != null) onCaptured(Captured(PassportScanner.jpegOf(bitmap), scanner.lastMrz)) else scanner.fired = false
                    }
                }.start()
            } else if (!scanner.fired) {
                main.execute { onUpdate(ScanUpdate(ScanPhase.Holding, (held.toFloat() / PassportScanner.STEADY_MS).coerceIn(0f, 1f))) }
            }
        }
        .addOnCompleteListener { image.close() }
}
