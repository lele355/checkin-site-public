/* app-shell.js — Capacitor 安卓壳适配
 *
 * 只在原生壳（APK）里生效；普通浏览器 / PWA 里第一行就 return，完全无副作用。
 * 依赖 Capacitor 的 document-start 注入：壳把 server.url 对应的源注册为注入源，
 * 所以远程加载的 example.com 页面里同样能拿到 window.Capacitor。
 */
(function () {
    var C = window.Capacitor;
    if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;

    document.documentElement.classList.add('is-native');

    var P = C.Plugins || {};

    // 1) 状态栏：顶栏是深绿色底，用浅色图标（Style.Dark = 深底浅字）
    if (P.StatusBar && P.StatusBar.setStyle) {
        P.StatusBar.setStyle({ style: 'DARK' }).catch(function () { });
    }

    // 2) 返回键：先关弹窗 → 再页面后退 → 最后一层才退出 App
    //    （不接管的话，安卓默认行为是一按就退出，体验很差）
    if (P.App && P.App.addListener) {
        P.App.addListener('backButton', function () {
            var dlg = document.querySelector('dialog[open]');
            if (dlg) { dlg.close(); return; }

            if (window.history.length > 1) { window.history.back(); return; }

            if (P.App.exitApp) P.App.exitApp();
        });
    }

    // 3) 首次进入把状态栏样式对齐一次主题（切主题时由 theme.js 触发下面的自定义事件）
    document.addEventListener('app:theme', function () {
        if (P.StatusBar && P.StatusBar.setStyle) {
            P.StatusBar.setStyle({ style: 'DARK' }).catch(function () { });
        }
    });
})();
