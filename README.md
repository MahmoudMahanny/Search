# لمّاح

تطبيق بحث لوحات السيارات السعودية — ويب + أندرويد.

## الويب (GitHub Pages)

افتح `index.html` من الموقع المنشور. البحث الصوتي في المتصفح يستخدم Web Speech API.

## تطبيق أندرويد (Google Speech — أدق)

التطبيق يغلف نفس الواجهة عبر **Capacitor** ويستخدم **Google SpeechRecognizer** (`ar-SA`) للمايك بدل المتصفح.

### المتطلبات

- Node.js 18+
- [Android Studio](https://developer.android.com/studio) (SDK + JDK)

### البناء

```bash
npm install
npm run cap:sync          # ينسخ الملفات إلى www/ ويحدّث مشروع أندرويد
npm run android:open      # يفتح Android Studio
```

من Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**  
أو من الطرفية:

```bash
cd android && ./gradlew assembleDebug
```

ملف الـ APK: `android/app/build/outputs/apk/debug/app-debug.apk`

### على الجهاز

1. ثبّت الـ APK
2. اسمح بإذن **الميكروfon** عند أول استخدام للمايك
3. الإنternet مطلوب للمسح (OCR) ورفع الشيت — المايك يستخدم Google على الجهاز (بدون إنترنت دائم)

### تحديث التطبيق (إشعار داخل التطبيق)

عند صدور نسخة أحدث، يظهر شريط **«تحديث جديد متاح»** داخل التطبيق. المستخدم يضغط **«تحديث الآن»** → يحمّل `lammah.apk` ويثبّته فوق النسخة القديمة.

ملف `android-version.json` على `main` يحدد آخر إصدار. لنشر تحديث:

1. GitHub → **Actions → Build Android APK → Run workflow**
2. يُرفع Release جديد + يتحدّث `android-version.json` تلقائياً
3. المستخدمون يفتحون التطبيق ويرون الإشعار
