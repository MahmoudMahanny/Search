package com.lammah.search;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reads the real installed APK version from PackageManager (versionName + versionCode).
 * More reliable than JS fallbacks when Capacitor App.getInfo() is unavailable.
 */
@CapacitorPlugin(name = "NativeVersion")
public class NativeVersionPlugin extends Plugin {

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            String pkg = getContext().getPackageName();
            PackageInfo pi = pm.getPackageInfo(pkg, 0);
            JSObject ret = new JSObject();
            ret.put("version", pi.versionName != null ? pi.versionName : "");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                ret.put("build", pi.getLongVersionCode());
            } else {
                ret.put("build", pi.versionCode);
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("NativeVersion failed: " + e.getMessage());
        }
    }
}
