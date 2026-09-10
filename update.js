/* update.js — Android in-app update check against android-version.json on GitHub */
(function () {
  const REMOTE_URLS = [
    'https://raw.githubusercontent.com/MahmoudMahanny/Search/main/android-version.json',
    'https://mahmoudmahanny.github.io/Search/android-version.json',
    './android-version.json',
    'android-version.json'
  ];
  const SESSION_DISMISS_KEY = 'lammahUpdateDismissedThisSession';
  const PENDING_UPDATE_KEY = 'lammahPendingUpdate';
  const NATIVE_CACHE_KEY = 'lammahNativeVersionCache';

  function isAppShell() {
    if (window.__LAMMAH_APP_SHELL__) return true;
    try {
      if (window.Capacitor?.getPlatform?.() === 'android') return true;
      if (window.Capacitor?.isNativePlatform?.()) return true;
    } catch (e) { /* ignore */ }
    const origin = window.location.origin || '';
    const href = window.location.href || '';
    return /^https?:\/\/localhost/i.test(origin) ||
      window.location.protocol === 'capacitor:' ||
      /android_asset/i.test(href);
  }

  function normalizeVersion(v) {
    return String(v || '').trim().replace(/^v/i, '');
  }

  function waitForCapacitor(maxMs) {
    const deadline = Date.now() + (maxMs || 8000);
    return new Promise((resolve) => {
      (function poll() {
        if (window.Capacitor?.registerPlugin) return resolve(window.Capacitor);
        if (Date.now() >= deadline) return resolve(window.Capacitor || null);
        setTimeout(poll, 50);
      })();
    });
  }

  function parseBuildCode(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return 0;
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
    return 0;
  }

  function compareSemver(a, b) {
    const pa = normalizeVersion(a).split('.').map((x) => parseInt(x, 10) || 0);
    const pb = normalizeVersion(b).split('.').map((x) => parseInt(x, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const da = pa[i] || 0;
      const db = pb[i] || 0;
      if (da !== db) return da < db ? -1 : 1;
    }
    return 0;
  }

  function cacheNativeVersion(info) {
    try {
      localStorage.setItem(NATIVE_CACHE_KEY, JSON.stringify({
        version: info.version || '',
        build: info.build || 0,
        at: Date.now()
      }));
    } catch (e) { /* ignore */ }
  }

  function loadCachedNativeVersion() {
    try {
      const raw = localStorage.getItem(NATIVE_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data) return null;
      const version = normalizeVersion(data.version);
      const build = parseBuildCode(data.build);
      if (version || build > 0) {
        return { version, build, source: 'cache' };
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function readNativeVersion() {
    if (!window.Capacitor?.registerPlugin) return loadCachedNativeVersion();

    try {
      const NativeVersion = window.Capacitor.registerPlugin('NativeVersion');
      if (NativeVersion?.getAppVersion) {
        const info = await NativeVersion.getAppVersion();
        const version = normalizeVersion(info.version);
        const build = parseBuildCode(info.build);
        if (version || build > 0) {
          const out = { version, build, source: 'native-pm' };
          cacheNativeVersion(out);
          return out;
        }
      }
    } catch (e) { /* ignore */ }

    try {
      const App = window.Capacitor.registerPlugin('App');
      const info = await App.getInfo();
      const version = normalizeVersion(info.version);
      const build = parseBuildCode(info.build);
      if (version || build > 0) {
        const out = { version, build, source: 'capacitor-app' };
        cacheNativeVersion(out);
        return out;
      }
    } catch (e) { /* ignore */ }

    return loadCachedNativeVersion();
  }

  async function getLocalInfo() {
    await waitForCapacitor(8000);

    if (isAppShell()) {
      const native = await readNativeVersion();
      if (native) return native;
      // Never use bundled db.js in the APK — it may be newer than the installed binary.
      return { version: '', build: 0, source: 'unknown' };
    }

    return {
      version: normalizeVersion(typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''),
      build: typeof APP_VERSION_CODE !== 'undefined' ? APP_VERSION_CODE : 0,
      source: 'bundled'
    };
  }

  async function fetchRemoteVersion() {
    let lastErr = null;
    for (let i = 0; i < REMOTE_URLS.length; i++) {
      try {
        const resp = await fetch(REMOTE_URLS[i] + '?t=' + Date.now(), {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const raw = await resp.json();
        if (!raw || !raw.versionCode || !raw.apkUrl) throw new Error('ملف التحديث غير صالح');
        return {
          version: normalizeVersion(raw.versionName),
          build: parseBuildCode(raw.versionCode),
          apkUrl: raw.apkUrl,
          notes: raw.notes || ''
        };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('تعذر جلب ملف التحديث');
  }

  function isNewer(remote, local) {
    if (!remote) return false;

    if (remote.version && local.version) {
      const cmp = compareSemver(remote.version, local.version);
      if (cmp > 0) return true;
      if (cmp < 0) return false;
    }

    const rBuild = remote.build || 0;
    const lBuild = local.build || 0;
    if (rBuild > 0 && lBuild > 0) return rBuild > lBuild;

    // Installed version unreadable — show update if remote exists and is newer by name.
    if (lBuild <= 0 && remote.version && !local.version) return true;
    if (lBuild <= 0 && remote.version && local.version) {
      return compareSemver(remote.version, local.version) > 0;
    }

    return rBuild > lBuild;
  }

  function formatVersionLine(local, remote) {
    const l = 'v' + (local.version || '?') + (local.build ? ' (كود ' + local.build + ')' : '');
    const r = remote ? 'v' + (remote.version || '?') + (remote.build ? ' (كود ' + remote.build + ')' : '') : '';
    return remote ? ('المثبّت: ' + l + ' | المتاح: ' + r) : l;
  }

  async function openApkUrl(url) {
    if (window.Capacitor?.registerPlugin) {
      try {
        const Browser = window.Capacitor.registerPlugin('Browser');
        await Browser.open({ url });
        return;
      } catch (e) { /* fall through */ }
    }
    window.open(url, '_blank');
  }

  function showBanner(remote) {
    const banner = document.getElementById('updateBanner');
    const msg = document.getElementById('updateBannerMsg');
    const btn = document.getElementById('updateBannerBtn');
    const dismiss = document.getElementById('updateBannerDismiss');
    if (!banner || !msg || !btn) return false;

    msg.textContent = (remote.version ? 'الإصدار v' + remote.version + ' — ' : '') +
      (remote.notes || 'حمّل النسخة الجديدة. إن فشل التثبيت: احذف التطبيق القديم أولاً ثم ثبّت من جديد.');
    banner.classList.add('visible');
    banner.style.display = 'flex';
    document.body.classList.add('has-update-banner');

    btn.onclick = () => openApkUrl(remote.apkUrl);
    if (dismiss) {
      dismiss.onclick = () => {
        try { sessionStorage.setItem(SESSION_DISMISS_KEY, String(remote.build)); } catch (e) {}
        banner.classList.remove('visible');
        banner.style.display = '';
        document.body.classList.remove('has-update-banner');
      };
    }
    return true;
  }

  function hideBanner() {
    const banner = document.getElementById('updateBanner');
    if (banner) {
      banner.classList.remove('visible');
      banner.style.display = '';
    }
    document.body.classList.remove('has-update-banner');
    setLauncherBadge(0);
  }

  function savePendingUpdate(remote) {
    try {
      localStorage.setItem(PENDING_UPDATE_KEY, JSON.stringify({
        build: remote.build,
        version: remote.version,
        apkUrl: remote.apkUrl,
        notes: remote.notes || ''
      }));
    } catch (e) { /* ignore */ }
  }

  function loadPendingUpdate() {
    try {
      const raw = localStorage.getItem(PENDING_UPDATE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.build || !data.apkUrl) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function clearPendingUpdate() {
    try { localStorage.removeItem(PENDING_UPDATE_KEY); } catch (e) { /* ignore */ }
  }

  async function setLauncherBadge(count) {
    if (!isAppShell() || !window.Capacitor?.registerPlugin) return;
    try {
      const Badge = window.Capacitor.registerPlugin('Badge');
      if (!Badge) return;
      if (count > 0) await Badge.setCount({ count });
      else await Badge.clear();
    } catch (e) { /* launcher may not support badges */ }
  }

  async function showSystemUpdateNotification(remote) {
    if (!isAppShell() || !window.Capacitor?.registerPlugin) return;
    try {
      const UpdateNotify = window.Capacitor.registerPlugin('UpdateNotify');
      if (UpdateNotify?.show) await UpdateNotify.show({ version: remote.version || '' });
    } catch (e) { /* ignore */ }
  }

  async function signalUpdateAvailable(remote, opts) {
    const silent = !!(opts && opts.silent);
    savePendingUpdate(remote);
    await setLauncherBadge(1);
    if (!silent) {
      showBanner(remote);
      await showSystemUpdateNotification(remote);
    }
  }

  /**
   * @param {{ force?: boolean, silent?: boolean }} opts
   * @returns {Promise<{status:'update'|'latest'|'web'|'error', local?:object, remote?:object, message:string}>}
   */
  async function checkForUpdate(opts) {
    const force = !!(opts && opts.force);
    const silent = !!(opts && opts.silent);

    if (!isAppShell()) {
      return { status: 'web', message: 'فحص التحديث متاح في تطبيق أندرويد فقط' };
    }

    let local;
    let remote;
    try {
      local = await getLocalInfo();
      remote = await fetchRemoteVersion();
    } catch (err) {
      const pending = loadPendingUpdate();
      if (pending) showBanner(pending);
      return {
        status: 'error',
        message: 'تعذر التحقق من التحديث — تأكد من الإنترنت (' + (err.message || err) + ')'
      };
    }

    if (!isNewer(remote, local)) {
      hideBanner();
      clearPendingUpdate();
      try {
        const UpdateNotify = window.Capacitor?.registerPlugin?.('UpdateNotify');
        if (UpdateNotify?.clear) await UpdateNotify.clear();
      } catch (e) { /* ignore */ }
      return {
        status: 'latest',
        local,
        remote,
        message: 'أنت على آخر نسخة — ' + formatVersionLine(local, remote)
      };
    }

    if (!force) {
      try {
        const dismissed = parseInt(sessionStorage.getItem(SESSION_DISMISS_KEY) || '0', 10);
        if (dismissed >= remote.build) {
          await signalUpdateAvailable(remote, { silent: true });
          return {
            status: 'update',
            local,
            remote,
            message: 'تحديث v' + remote.version + ' متاح — ' + formatVersionLine(local, remote)
          };
        }
      } catch (e) { /* ignore */ }
    } else {
      try { sessionStorage.removeItem(SESSION_DISMISS_KEY); } catch (e) {}
    }

    await signalUpdateAvailable(remote, { silent: force ? false : silent });

    return {
      status: 'update',
      local,
      remote,
      message: 'تحديث جديد: v' + remote.version + ' — ' + formatVersionLine(local, remote)
    };
  }

  let listenerReady = false;
  async function startAutoUpdateChecks() {
    if (!isAppShell()) return;

    await waitForCapacitor(8000);

    const pending = loadPendingUpdate();
    if (pending) {
      setLauncherBadge(1);
      showBanner(pending);
    }

    setTimeout(() => { checkForUpdate({ force: false }); }, 600);

    if (listenerReady || !window.Capacitor?.registerPlugin) return;
    listenerReady = true;
    try {
      const App = window.Capacitor.registerPlugin('App');
      await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          try { sessionStorage.removeItem(SESSION_DISMISS_KEY); } catch (e) {}
          setTimeout(() => { checkForUpdate({ force: false }); }, 400);
        }
      });
    } catch (e) { /* ignore */ }
  }

  window.LammahUpdate = {
    checkForUpdate,
    startAutoUpdateChecks,
    openApkUrl,
    isAppShell,
    getLocalInfo,
    setLauncherBadge,
    showBanner,
    hideBanner
  };
})();
