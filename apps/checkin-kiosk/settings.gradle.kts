// STAY ARI 셀프 체크인 — 건물 태블릿 앱(16 §5). Foldy 웹 · Capacitor 앱과 따로 빌드한다.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // LiveKit 이 쓰는 오디오 장치 선택 라이브러리(audioswitch)만 JitPack 에서 받는다 — 다른 것은 받지 않게 묶어 둔다.
        maven("https://jitpack.io") {
            content { includeGroup("com.github.davidliu") }
        }
    }
}
rootProject.name = "checkin-kiosk"
include(":app")
