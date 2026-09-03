/* update.js — Android in-app update check against android-version.json on GitHub */
(function () {
  const REMOTE_URL =
    'https://raw.githubusercontent.com/MahmoudMahanny/Search/main/android-version.json';
  const SESSION_DISMISS_KEY = 'lammahUpdateDismissedThisSession';

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

  async function getLocalInfo() {
    if (window.Capacitor?.registerPlugin) {
      try {
        const App = window.Capacitor.registerPlugin('App');
        const info = await App.getInfo();
        return {
          version: normalizeVersion(info.version) || (typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''),
          build: parseInt(info.build, 10) || (typeof APP_VERSION_CODE !== 'undefined' ? APP_VERSION_CODE : 0)
        };
      } catch (e) { /* fall through */ }
    }
    return {
      version: typeof APP_VERSION !== 'undefined' ? String(APP_VERSION) : '0.1.10',
      build: typeof APP_VERSION_CODE !== 'undefined' ? APP_VERSION_CODE : 11
    };
  }

  async function fetchRemoteVersion() {
    const resp = await fetch(REMOTE_URL + '?t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const remote = await resp.json();
    if (!remote || !remote.versionCode || !remote.apkUrl) throw new Error('ملف التحديث غير صالح');
    return {
      version: normalizeVersion(remote.versionName),
      build: parseInt(remote.versionCode, 10) || 0,
      apkUrl: remote.apkUrl,
      notes: remote.notes || ''
    };
  }

  function isNewer(remote, local) {
    if (remote.build > 0 && local.build > 0 && remote.build > local.build) return true;
    if (remote.version && local.version && remote.version !== local.version && remote.build > local.build) return true;
    if (remote.build > local.build) return true;
    return false;
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
    document.body.classList.add('has-update-banner');

    btn.onclick = () => openApkUrl(remote.apkUrl);
    if (dismiss) {
      dismiss.onclick = () => {
        try { sessionStorage.setItem(SESSION_DISMISS_KEY, String(remote.build)); } catch (e) {}
        banner.classList.remove('visible');
        document.body.classList.remove('has-update-banner');
      };
    }
    return true;
  }

  function hideBanner() {
    const banner = document.getElementById('updateBanner');
    if (banner) banner.classList.remove('visible');
    document.body.classList.remove('has-update-banner');
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
      return {
        status: 'error',
        message: 'تعذر التحقق من التحديث — تأكد من الإنترنت (' + (err.message || err) + ')'
      };
    }

    if (!isNewer(remote, local)) {
      hideBanner();
      return {
        status: 'latest',
        local,
        remote,
        message: 'أنت على آخر نسخة (v' + (local.version || remote.version) + ')'
      };
    }

    if (!force) {
      try {
        const dismissed = parseInt(sessionStorage.getItem(SESSION_DISMISS_KEY) || '0', 10);
        if (dismissed >= remote.build) {
          return {
            status: 'update',
            local,
            remote,
            message: 'في تحديث متاح (v' + remote.version + ') — تم إخفاؤه لهذه الجلسة'
          };
        }
      } catch (e) { /* ignore */ }
    } else {
      try { sessionStorage.removeItem(SESSION_DISMISS_KEY); } catch (e) {}
    }

    if (!silent) showBanner(remote);

    return {
      status: 'update',
      local,
      remote,
      message: 'تحديث جديد متاح: v' + remote.version
    };
  }

  let listenerReady = false;
  async function startAutoUpdateChecks() {
    if (!isAppShell()) return;

    // Every app open — check quickly.
    setTimeout(() => { checkForUpdate({ force: false }); }, 1500);

    if (listenerReady || !window.Capacitor?.registerPlugin) return;
    listenerReady = true;
    try {
      const App = window.Capacitor.registerPlugin('App');
      await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          // Coming back to the app counts as "entering" — show again if outdated.
          try { sessionStorage.removeItem(SESSION_DISMISS_KEY); } catch (e) {}
          setTimeout(() => { checkForUpdate({ force: false }); }, 1200);
        }
      });
    } catch (e) { /* ignore */ }
  }

  window.LammahUpdate = {
    checkForUpdate,
    startAutoUpdateChecks,
    openApkUrl,
    isAppShell,
    getLocalInfo
  };
})();
