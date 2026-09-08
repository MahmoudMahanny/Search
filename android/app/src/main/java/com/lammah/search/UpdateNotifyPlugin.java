package com.lammah.search;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Shows a system notification when an app update is available.
 */
@CapacitorPlugin(name = "UpdateNotify")
public class UpdateNotifyPlugin extends Plugin {

    private static final String CHANNEL_ID = "lammah_updates";
    private static final int NOTIFICATION_ID = 9001;

    private void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "تحديثات لمّاح",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("إشعار عند توفر نسخة جديدة من التطبيق");
        channel.enableVibration(true);
        nm.createNotificationChannel(channel);
    }

    @PluginMethod
    public void show(PluginCall call) {
        Context ctx = getContext();
        String version = call.getString("version", "");
        ensureChannel(ctx);

        Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        if (launch == null) {
            call.reject("No launch intent");
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pending = PendingIntent.getActivity(ctx, 0, launch, flags);

        String title = "تحديث جديد متاح";
        String body = version.isEmpty()
            ? "افتح التطبيق واضغط «تحديث الآن»"
            : "الإصدار v" + version + " — افتح التطبيق للتحديث";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setNumber(1);

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, builder.build());
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Context ctx = getContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
        call.resolve();
    }
}
