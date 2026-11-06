plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// 서버 주소: `-PcheckinApiBase=https://…` 로 넘긴다. 없으면 이 Mac 의 개발 서버 — `adb reverse tcp:3100 tcp:3100` 으로 기기의 127.0.0.1:3100 을 잇는다
// (Android 17 은 앱이 사설 주소 10.0.2.2 로 나가는 것을 막는다).
val apiBase = (findProperty("checkinApiBase") as String?) ?: "http://127.0.0.1:3100"

android {
    namespace = "com.harutokyo.checkin.kiosk"
    compileSdk = 37

    // 손님이 고른 언어로 화면 안에서 바꾸므로(ui/Theme.kt Localized) 언어별 분할 설치를 끈다 — 4개 언어가 늘 기기에 있어야 한다.
    bundle {
        language {
            enableSplit = false
        }
    }

    defaultConfig {
        applicationId = "com.harutokyo.checkin.kiosk"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "API_BASE", "\"$apiBase\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // 실제 태블릿 CPU 만 — LiveKit(WebRTC) 네이티브 라이브러리가 CPU 종류마다 들어가 크기가 크다. 디버그 빌드(에뮬레이터)는 그대로 둔다.
            ndk { abiFilters += "arm64-v8a" }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    // 여권 찍기 · MRZ 읽기(16 §1-0 ① ②): CameraX + ML Kit 글자 읽기(기기 안 모델 — 사용료 · 네트워크 없음).
    implementation("androidx.camera:camera-camera2:1.5.0")
    implementation("androidx.camera:camera-lifecycle:1.5.0")
    implementation("androidx.camera:camera-view:1.5.0")
    // 빠른 체크인 — 얼굴 영상 5초(소리 없음).
    implementation("androidx.camera:camera-video:1.5.0")
    implementation("com.google.mlkit:text-recognition:16.0.1")

    // 직원 통화(46) — 손님 카메라 + 마이크를 LiveKit 방에 올리고 직원 음성을 받는다.
    implementation("io.livekit:livekit-android:2.30.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
