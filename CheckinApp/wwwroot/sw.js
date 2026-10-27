/* 日常管理 · Service Worker
 *
 * 设计原则（重要）：
 *   1. HTML 一律走网络，绝不缓存页面 —— 之前踩过「旧页面被缓存钉死 / 白屏」的坑；
 *   2. 只缓存带版本号的静态资源（css/js/图标），靠 _Layout 里的 asp-append-version 天然拿新 URL；
 *   3. 断网时导航请求回落到 /offline.html，而不是系统那张「网页无法打开」的丑页面；
 *   4. 改静态资源不用动这个文件；想强制清空旧缓存时把 VER 加 1。
 *
 * 注意：本项目是 Razor Pages 服务端渲染，没有离线数据能力（页面 HTML 由服务器生成）。
 *      这里的「离线」仅指：静态资源可复用 + 断网有一张体面的兜底页。
 */

const VER = 'v1';
const PRECACHE = [
    '/offline.html',
    '/css/tokens.css',
    '/css/themes.css',
    '/css/site.css',
    '/js/theme.js',
    '/js/site.js',
    '/js/modal.js',
    '/icons/icon-192.png',
    '/icons/icon-maskable-192.png'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(VER);
        // 逐个 add 并吞掉失败：任何一个 404 都不该让整个 SW 装不上
        await Promise.all(PRECACHE.map(url => cache.add(url).catch(() => { })));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;   // 外链不插手

    // 1) 页面导航：网络优先，失败回落离线页
    if (req.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                return await fetch(req);
            } catch (e) {
                const cache = await caches.open(VER);
                return (await cache.match('/offline.html')) || Response.error();
            }
        })());
        return;
    }

    // 2) 静态资源：缓存优先（URL 带 ?v=，版本变了自然换 key）
    //    lib/ 是第三方库（目前只有 PDF.js），同样带版本号，缓存下来省 1.3MB 重复下载
    if (/^\/(css|js|icons|lib)\//.test(url.pathname)) {
        event.respondWith((async () => {
            const cache = await caches.open(VER);
            const hit = await cache.match(req);
            if (hit) return hit;
            const res = await fetch(req);
            if (res && res.ok) cache.put(req, res.clone());
            return res;
        })());
    }

    // 3) 其余（接口 JSON、图片上传、/Preferences 等）一律直连，不缓存
});
