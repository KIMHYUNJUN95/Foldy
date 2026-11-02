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
    }
}
rootProject.name = "checkin-kiosk"
include(":app")
