# AI CONTEXT — Trade Manager

## هدف فعلی
ادامه توسعه و اصلاح ظاهر Trade Manager بدون تغییر منطق محاسبات.

## قانون اصلی
- منطق محاسبات، Win / BE / Lose، Simple، Masaniello و Planner بدون درخواست صریح تغییر نکنند.
- تغییرات حداقلی و دقیق باشند.
- کد قدیمیِ مربوط به تغییرات جایگزین‌شده باقی نماند.
- Patch روی Patch ساخته نشود؛ قبل از تغییر، وضعیت واقعی فایل بررسی و کد قبلی غیرضروری پاک شود.
- Portrait نباید باعث خراب شدن Landscape شود.

## وضعیت UI فعلی
- Header در Portrait فعلاً قابل قبول است.
- دکمه مکث در Header باید فقط علامت `⏸` باشد و کوچک باشد.
- فاصله دکمه مکث با سایر عناصر Header مناسب باشد.
- باکس اول نباید عنوان اضافی «سشن / معاملات» داشته باشد.
- شروع محتوای باکس اول با دکمه‌های:
  - Win
  - BE
  - Lose
- ردیف بعد:
  - Clear
  - Undo
  - Session
- ارتفاع کلی عناصر اخیراً کاهش داده شده و ظاهر جمع‌وجورتر مطلوب است.
- ظاهر فعلی که طراحی شد مورد تأیید کاربر است؛ فقط نباید دوباره بیش از حد بزرگ شود.

## Fullscreen
هدف فعلی: تمام‌صفحه کردن برنامه Android.
- Status bar و Navigation bar حذف شوند.
- حتماً Punch-hole / Camera cutout در نظر گرفته شود.
- نباید Header یا محتوای برنامه زیر قسمت خطرناک دوربین قرار بگیرد.
- تغییرات Android باید فقط در صورت نیاز انجام شوند.
- MainActivity.java که قبلاً موقتاً ساخته شده بود حذف شده است.
- Manifest Android در وضعیت فعلی در Repo موجود نیست / بررسی شود؛ چیزی را از روی حدس ایجاد نکن.

## آخرین وضعیت Git
آخرین Commit: 64d9831 — fix: compact responsive UI and stress test controls

Commitهای اخیر:
- 5dc3e14 Remove temporary AI work logs
- 11e0cb7 Add AI change control log
- e217641 Update AI worklog
- ce277f2 Polish portrait trade action layout
- 37f0e24 Adjust header and pause button layout

## وضعیت Working Tree
آخرین گزارش:
`src/css/app.css` تغییر داده شده و هنوز باید وضعیت آن بررسی شود.

قبل از هر تغییر:
1. `git status --short`
2. فایل واقعی مربوطه را بخوان.
3. تغییر موجود را بررسی کن.
4. فقط سپس تغییر بده.

## کارهای انجام‌شده مهم
- جابه‌جایی/کوچک‌سازی Pause button در Header.
- اصلاح safe-area مربوط به Header.
- اصلاح چیدمان دکمه‌های Portrait.
- تلاش برای Android fullscreen با MainActivity انجام شد ولی فایل موقت حذف شد.
- فایل‌های AI.md و AI_WORKLOG.md به دلیل موقت بودن حذف شدند.
- این فایل (`AI_CONTEXT.md`) باید باقی بماند و به عنوان حافظه پروژه استفاده شود.

## قدم بعدی
اول وضعیت واقعی Repo و `src/css/app.css` بررسی شود.
سپس ادامه کار Fullscreen با توجه به Punch-hole دوربین انجام شود.
هیچ فایل یا شاخه اضافی بدون دلیل ایجاد نشود.

## نکته مهم
اگر کاربر گفت:
«برو AI_CONTEXT.md رو بخون»
ابتدا همین فایل خوانده شود و کار از وضعیت ثبت‌شده ادامه پیدا کند؛ از کاربر نخواه درباره کارهای قبلی دوباره توضیح بدهد.

## قانون مرجع ادامه کار
- `AI_CONTEXT.md` مرجع اصلی وضعیت و ادامه کار پروژه است.
- در ادامه کار، محتوای `AI_CONTEXT.md` ملاک اصلی تصمیم‌گیری و ادامه توسعه باشد.
- لازم نیست برای هر مرحله تاریخچه Git، commitهای قبلی یا تغییرات گذشته دوباره بررسی شوند، مگر اینکه برای حل یک مسئله مشخص یا تأیید یک وضعیت واقعی ضرورت داشته باشد.
- از کاربر درباره کارهای قبلی که در `AI_CONTEXT.md` ثبت شده‌اند دوباره سؤال نشود.
- پس از هر تغییر مهم، `AI_CONTEXT.md` باید با وضعیت جدید، تصمیم‌های گرفته‌شده و قدم بعدی به‌روز شود.
- هدف این است که AI بتواند از همین فایل مستقیماً کار را ادامه دهد، بدون ایجاد بررسی‌های تکراری و غیرضروری.


## وضعیت فعلی — Portrait Cockpit Phase 1
- تغییرات `src/css/app.css` برای Portrait Cockpit Phase 1 بررسی شد.
- این تغییرات فقط CSS و ظاهر هستند و منطق محاسبات، Win / BE / Lose، Simple، Masaniello و Planner را تغییر نمی‌دهند.
- selectorهای اصلی تغییرات در `index.html` واقعاً وجود دارند و CSS روی ساختار واقعی برنامه اعمال می‌شود.
- `git diff --check` بدون خطا است.
- Portrait شامل فشرده‌سازی فاصله‌ها، دکمه‌های اصلی Win / BE / Lose، دکمه‌های ثانویه، Session، تاریخچه معاملات، Next Stake، Target/Plan و Pause button است.
- برای نمایشگرهای portrait کوچک‌تر از 420px نیز تنظیمات جداگانه وجود دارد.
- تغییرات Landscape نباید تحت تأثیر این media queryهای portrait قرار بگیرند.
- تغییرات فعلی `src/css/app.css` هنوز commit نشده‌اند.
- `AI_CONTEXT.md` نیز به‌خاطر ثبت قوانین مرجع ادامه کار تغییر کرده و هر دو فایل باید در یک commit ثبت شوند.
- قدم بعدی: commit و push کردن `AI_CONTEXT.md` و `src/css/app.css`، سپس ادامه کار Fullscreen واقعی Android با توجه به Punch-hole / Camera cutout.

## Android Build Architecture — مهم
- APK پروژه از طریق GitHub Actions ساخته می‌شود؛ Termux محیط build اصلی APK نیست.
- Workflow اصلی build در `.github/workflows/build.yml` قرار دارد.
- GitHub Actions ابتدا dependencies را نصب می‌کند، سپس `npm run build` را اجرا می‌کند.
- Android platform در زمان Workflow با `npx cap add android` ساخته می‌شود؛ بنابراین نبودن پوشه `android/` در repository فعلی طبیعی است.
- سپس `npx cap sync android` اجرا می‌شود و APK با `cd android && ./gradlew assembleDebug` ساخته می‌شود.
- خروجی APK در `android/app/build/outputs/apk/debug/app-debug.apk` قرار می‌گیرد.
- بنابراین برای تغییرات Android/Fullscreen/Punch-hole باید راهکار را با معماری فعلی GitHub Actions هماهنگ کرد و نباید صرفاً برای ساخت APK در Termux، `android/` را به پروژه اضافه کرد.
- خطای `npm install` در Termux مربوط به dependency native `sharp` و نبودن prebuilt libvips برای android-arm64v8 بود؛ این خطا به‌تنهایی دلیل تغییر dependencyهای پروژه نیست.
- قبل از تغییر دادن مسیر build یا اضافه کردن Android platform دائمی به repository، `.github/workflows/build.yml` ملاک اصلی معماری build است.

## وضعیت Android / APK Build — مرجع دائمی

- ساخت APK پروژه از طریق **GitHub Actions** انجام می‌شود، نه Termux.
- Workflow اصلی: `.github/workflows/build.yml`
- Workflow روی `push` به `main` و `workflow_dispatch` اجرا می‌شود.
- GitHub Actions از Node.js 22 و JDK 21 استفاده می‌کند.
- در CI ابتدا dependencies نصب، سپس check/test/build وب اجرا می‌شود.
- Android در CI با `npx cap add android` ساخته می‌شود و `android/` به‌صورت دائمی داخل Repo نگهداری نمی‌شود.
- سپس `npx cap sync android` و Gradle `assembleDebug` اجرا می‌شود.
- APK نهایی به‌عنوان Artifact با نام `TradeManager-debug-apk` ذخیره می‌شود.
- پروژه از Capacitor استفاده می‌کند:
  - `@capacitor/core` 8.5.0
  - `@capacitor/android` 8.5.0
  - `@capacitor/cli` 8.5.0
  - `@capacitor/app` 8.1.1
  - `@capacitor/status-bar` 8.0.3
- `npm install` در Termux به‌دلیل dependency `sharp` و نبود prebuilt libvips برای Android arm64 شکست خورد؛ بنابراین برای APK نباید build محلی Termux را مبنا قرار داد.
- workflow فعلی عمداً `android.permission.INTERNET` را قبل و بعد از `cap sync` حذف و سپس بررسی می‌کند؛ پروژه باید offline-only باقی بماند.
- برای تغییرات Android/Fullscreen لازم نیست `android/` را دستی در Repo ایجاد کنیم؛ تغییرات باید با معماری GitHub Actions و Capacitor سازگار باشند.
- `capacitor.config.json` فعلی:
  - appId: `com.re3ae6.trademanager`
  - appName: `Trade Manager`
  - webDir: `www`

## Fullscreen — وضعیت فعلی

هدف:
- حذف Status Bar و Navigation Bar در APK Android.
- حفظ safe-area و جلوگیری از قرار گرفتن Header/محتوا زیر Punch-hole یا Camera Cutout.
- هیچ محتوای مهمی نباید زیر قسمت خطرناک دوربین قرار بگیرد.
- Android fullscreen باید با معماری فعلی Capacitor/GitHub Actions پیاده‌سازی شود، نه با حدس یا ایجاد فایل Android دائمی.

وضعیت فعلی:
- `index.html` دارای `viewport-fit=cover` است.
- CSS فعلی قرارداد safe-area دارد و از `env(safe-area-inset-top)` و `env(safe-area-inset-bottom)` استفاده می‌کند.
- `app.js` تابع `applyNativeTheme()` دارد و از Capacitor StatusBar plugin برای تنظیم رنگ/استایل Status Bar استفاده می‌کند.
- fullscreen واقعی Android با `SystemBars.hide()` پیاده‌سازی شده است.
- `MainActivity.java` که قبلاً موقتاً برای fullscreen ساخته شده بود حذف شده و نباید بدون نیاز واقعی دوباره ساخته شود.
- قبل از هر تغییر جدید در fullscreen باید راهکار مناسب Capacitor 8 و Android generated project در GitHub Actions مشخص شود.
- تغییر fullscreen نباید قرارداد فعلی safe-area، Header، Portrait/Landscape یا offline-only را خراب کند.

## قانون Build

برای تست APK:
- تغییرات را commit و push به `main` کن.
- GitHub Actions باید APK را بسازد.
- APK از Artifact workflow دریافت می‌شود.
- شکست `npm install` در Termux به‌تنهایی نشانه خرابی پروژه نیست، چون build رسمی پروژه در GitHub Actions انجام می‌شود.

## وضعیت فعلی Working Tree

- `AI_CONTEXT.md` برای ثبت وضعیت Android/GitHub Actions به‌روزرسانی شده است.
- `src/css/app.css` و تغییرات Portrait Cockpit قبلاً در commit `1d6a5c6` ثبت و push شده‌اند.
- commit `1d6a5c6` با موفقیت به `origin/main` push شده است.
- قدم بعدی پروژه: ادامه بررسی و پیاده‌سازی Android Fullscreen واقعی، با توجه به Punch-hole/Camera Cutout و حفظ safe-area.

## Android Fullscreen / Navigation Bar — وضعیت جدید

### نتیجه تست APK
- APK از طریق GitHub Actions ساخته می‌شود؛ برای ساخت APK در Termux نباید `android/` به Repo اضافه شود.
- Navigation Bar اندروید باید **نمایان بماند**؛ کاربر نوار سیستم با دکمه‌های مثلث/دایره/مربع را می‌خواهد.
- در تست APK مشخص شد که هنگام اسکرول، محتوای برنامه از زیر Navigation Bar عبور می‌کند.
- بنابراین هدف Fullscreen به معنی حذف Navigation Bar نیست؛ هدف این است که محتوای برنامه در محدوده امن سیستم قرار بگیرد.
- Punch-hole / Camera cutout همچنان باید با safe-area بالای صفحه رعایت شود.
- خوانایی Status Bar نیز مهم است؛ رنگ/استایل آن نباید باعث سخت شدن خواندن وضعیت شود.

### تغییرات فعلی Safe Area
- `capacitor.config.json`:
  - `SystemBars.hidden` روی `true` است تا برنامه در شروع fullscreen اجرا شود.
  - `insetsHandling` روی `css` باقی مانده است.
- `src/css/app.css`:
  - متغیرهای safe-area برای top و bottom اضافه/تقویت شده‌اند.
  - `body` در موبایل از `--safe-area-inset-bottom` استفاده می‌کند.
  - ارتفاع `.app` از `100dvh` با احتساب safe-area بالا و پایین محاسبه می‌شود.
  - `.app` دارای `padding-top` و `padding-bottom` بر اساس safe-area است.
- `git diff --check` بدون خطا است.
- تغییرات فعلی فقط در `AI_CONTEXT.md`، `capacitor.config.json` و `src/css/app.css` هستند.

### تصمیم مهم
- Navigation Bar اندروید حذف نشود.
- محتوای قابل اسکرول نباید زیر Navigation Bar قرار بگیرد.
- برای اصلاحات Android/Fullscreen ابتدا معماری فعلی GitHub Actions و Capacitor ملاک باشد.
- `android/` را فقط برای ساخت APK در Git ایجاد نکن.
- قبل از تغییرات بعدی، همین فایل (`AI_CONTEXT.md`) مرجع اصلی وضعیت پروژه است و لازم نیست تاریخچه Git یا کارهای قبلی بدون دلیل دوباره بررسی شوند.

### قدم بعدی
- Commit و push تغییرات Safe Area.
- سپس GitHub Actions APK جدید بسازد.
- APK جدید روی دستگاه تست شود:
  1. Navigation Bar همچنان دیده شود.
  2. محتوای برنامه هنگام اسکرول زیر Navigation Bar نرود.
  3. Header و Punch-hole دوربین درست بمانند.
  4. خوانایی Status Bar بررسی شود.
- فقط بر اساس نتیجه تست واقعی APK، مرحله بعدی اصلاح شود.

## آخرین وضعیت Fullscreen Android — 2026-08-15

- APK از طریق GitHub Actions ساخته می‌شود؛ پروژه در Termux برای ساخت APK به `android/` نیاز ندارد.
- Fullscreen واقعی Android با Capacitor `SystemBars` فعال است.
- `capacitor.config.json` از `SystemBars` با `insetsHandling: "css"` استفاده می‌کند.
- وضعیت اولیه System Bars باید مخفی باشد (`hidden: true`).
- کاربر در تست واقعی تأیید کرد که:
  - برنامه بدون Status Bar و Navigation Bar اجرا می‌شود.
  - با swipe از پایین، Navigation Bar ظاهر می‌شود و Status Bar نیز ممکن است ظاهر شود.
  - در نسخه قبلی، پس از ظاهر شدن System Bars دوباره hide نمی‌شد.
  - هنگام ظاهر بودن System Bars، بخشی از UI هنگام scroll زیر Status/Navigation دیده می‌شد.
- راهکار فعلی:
  - `SystemBars.hide()` برای fullscreen استفاده می‌شود؛ این API در Capacitor 8 هر دو System Bar را مخفی می‌کند.
  - تغییر safe-area از طریق `--safe-area-inset-*` پایش می‌شود.
  - پس از reveal شدن System Bars، تایمر auto-hide حدود ۲.۵ ثانیه فعال می‌شود.
  - تعامل کاربر (`pointerdown`, `touchstart`, `wheel`, `scroll`) تایمر را reset می‌کند تا هنگام استفاده، نوارها فوراً مخفی نشوند.
  - `resize` و `visualViewport.resize` و یک polling سبک برای تشخیص تغییر safe-area استفاده شده‌اند.
- هدف رفتاری:
  - شروع برنامه: fullscreen.
  - reveal با gesture: System Bars موقتاً قابل مشاهده باشند.
  - بدون تعامل پس از حدود ۲.۵ ثانیه: دوباره hide شوند.
  - navigation mode مثلث/دایره/مربع Android نباید دستکاری شود.
  - safe-area باید هنگام visible بودن System Bars رعایت شود.
- تغییرات فعلی هنوز باید روی APK جدید GitHub Actions تست شوند.
- قبل از تغییر بعدی:
  1. `git status --short`
  2. `git diff --check`
  3. diff واقعی فایل‌ها بررسی شود.
- بعد از تست APK، نتیجه واقعی رفتار System Bars و safe-area در همین بخش ثبت شود.

## وضعیت مستندات — آخرین به‌روزرسانی

- آخرین Commit فعلی: `64d9831` — `fix: compact responsive UI and stress test controls`
- `AI_CONTEXT.md` فایل اصلی Context پروژه است.
- `ai_context.md` نسخه قدیمی/تکراری بود و حذف شده است.
- `PROJECT_CHANGELOG.md` تاریخچه رسمی تغییرات پروژه است.
- گزارش‌های Phase 18 تا Phase 21 به‌عنوان سوابق فنی نگه داشته می‌شوند.
- تغییرات اخیر UI شامل compact responsive UI و Stress Test controls است.
- منطق محاسباتی Simple، Masaniello، Planner، Recovery، Risk Engine و Session بدون تغییر عمدی در این UI pass باقی مانده است.
- آخرین بررسی تست پروژه پیش از این cleanup: `npm test` با **87/87 PASS**.
