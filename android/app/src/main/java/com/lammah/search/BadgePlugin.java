package com.lammah.search;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import me.leolin.shortcutbadger.ShortcutBadger;

/**
 * Sets launcher icon badge count (e.g. "1" when an app update is available).
 * Uses ShortcutBadger for Samsung, Xiaomi, Huawei, and other OEM launchers.
 */
@CapacitorPlugin(name = "Badge")
public class BadgePlugin extends Plugin {

    @PluginMethod
    public void setCount(PluginCall call) {
        int count = call.getInt("count", 0);
        try {
            if (count <= 0) {
                ShortcutBadger.removeCount(getContext());
            } else {
                ShortcutBadger.applyCount(getContext(), count);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Badge failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        try {
            ShortcutBadger.removeCount(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("Badge clear failed: " + e.getMessage());
        }
    }
}
