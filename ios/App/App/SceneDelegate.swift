import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        // 꺼진 앱을 아이콘 꾹 누르기 메뉴로 켰다 — 웹이 뜬 뒤 App.getLaunchUrl() 로 읽는다.
        if let shortcutItem = connectionOptions.shortcutItem {
            _ = openShortcut(shortcutItem)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    // 켜져 있던 앱을 아이콘 꾹 누르기 메뉴로 열었다 — 웹은 appUrlOpen 으로 받는다.
    func windowScene(_ windowScene: UIWindowScene, performActionFor shortcutItem: UIApplicationShortcutItem, completionHandler: @escaping (Bool) -> Void) {
        completionHandler(openShortcut(shortcutItem))
    }

    /// 앱 아이콘 꾹 누르기 메뉴(2026-10-22, Info.plist UIApplicationShortcutItems) → `com.harutokyo.foldy://open/<type>`.
    /// 앱 스킴 주소와 같은 길(Capacitor App 플러그인)로 넘겨, 어느 화면을 열지는 웹이 정한다(src/lib/native-app.ts nativeShortcutToWebPath).
    private func openShortcut(_ shortcutItem: UIApplicationShortcutItem) -> Bool {
        guard let url = URL(string: "com.harutokyo.foldy://open/\(shortcutItem.type)") else { return false }
        return ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }
}
