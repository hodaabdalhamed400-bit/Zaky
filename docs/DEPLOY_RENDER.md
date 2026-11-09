# النشر على Render

> ⚠️ **قبل إدخال بيانات عملاء حقيقية:** Render لا يملك منطقة استضافة داخل المملكة. راجع متطلبات نظام حماية البيانات الشخصية (PDPL) ونقل البيانات خارج المملكة مع المستشار القانوني. النشر التجريبي ببيانات اختبار فقط لا يتأثر بذلك.

## الاستقلال عن Smart Meet
خدمة Render جديدة باسم `zaki-erp`، بقاعدة بيانات جديدة `zaki-erp-db`، ونطاق فرعي جديد. لا تُمس أي خدمة أو قاعدة أو DNS خاص بـ Smart Meet.

## الخطوات
1. في Render: **New → Blueprint** واختر هذا المستودع؛ سيقرأ `render.yaml` وينشئ الخدمة وقاعدة PostgreSQL 16.
   (`autoDeploy: false` — النشر يدوي حتى تستقر المراحل.)
2. أثناء النشر يُشغَّل `preDeployCommand`: الترحيلات (`prisma migrate deploy`) ثم مزامنة البيانات المرجعية (`db:seed`، آمن للتكرار، لا ينشئ مستخدمين).
3. إنشاء مسؤول النظام الأول من **Render Shell** للخدمة:
   ```bash
   npm run admin:create -- --email it@your-domain.sa --name "اسم المسؤول"
   # ستُطلب كلمة المرور بشكل مخفي، ويجب تغييرها عند أول دخول
   ```
4. النطاق: **Settings → Custom Domains** أضف النطاق الفرعي (مثل `erp.your-domain.sa`) ثم سجل CNAME لدى مزود DNS. Render يصدر شهادة HTTPS تلقائيًا.
5. تحقق: `https://<domain>/api/health` يجب أن يعيد `{"status":"ok"}`.

## تخزين المستندات
- **مكان الحفظ:** المستندات محفوظة على قرص Render دائم (`/var/data`) مرتبط بخدمة الويب، وتُنزَّل فقط عبر `/api/documents/[id]` بعد التحقق من الجلسة والصلاحيات.
- **قيد القرص الدائم:** يمنع النشر بدون توقف، ويعني أن الخدمة تعمل بنسخة واحدة.
- **التوسع لاحقًا:** يمكن الانتقال إلى تخزين S3 متوافق، داخل المملكة إن لزم.
- **النسخ الاحتياطي للقرص منفصل عن قاعدة البيانات.** من Render Shell:
  ```bash
  tar -czf /tmp/storage-$(date +%F).tgz -C /var/data storage   # ثم انقله خارج Render مشفرًا
  ```

## المهمة اليومية
- **الوظيفة:** خدمة Cron مستقلة (`zaki-erp-daily`) تشغّل `npm run job:daily` يوميًا الساعة 00:15 بتوقيت الرياض. تُنهي العقود المنتهية وتنشئ مسودات التجديد.
- **التشغيل المتكرر آمن:** لا يكرر أي شيء.
- **بديل عبر HTTP:** `POST /api/cron/daily` مع الترويسة `Authorization: Bearer $CRON_SECRET`.

## متغيرات البيئة
| المتغير | ملاحظات |
|---|---|
| `DATABASE_URL` | يُربط تلقائيًا من قاعدة Render (Internal URL). |
| `NODE_ENV=production` | يفعّل الكوكي الآمنة. |
| `SESSION_MAX_AGE_HOURS` / `SESSION_IDLE_TIMEOUT_MINUTES` | 12 ساعة / 120 دقيقة افتراضيًا. |
| `TRUSTED_PROXY_HOPS=1` | لقراءة IP العميل الحقيقي خلف موازن Render. |
| `STORAGE_DIR` | `/var/data/storage` على القرص الدائم. |
| `CRON_SECRET` | يُولَّد تلقائيًا، ويحمي نقطة المهمة اليومية. |

لا توجد أي أسرار داخل الكود. لا تضع `ZAKI_ADMIN_PASSWORD` كمتغير دائم في Render.

## البيئات
- **تطوير:** محلي (`.env`).
- **اختبار (Staging):** نسخة ثانية من الـ Blueprint باسم مختلف وقاعدة مستقلة وبيانات اختبار فقط.
- **إنتاج:** خدمة وقاعدة منفصلتان؛ لا تُنسخ بيانات الإنتاج إلى بيئة أخرى.

## النسخ الاحتياطي والاستعادة
- خطط Render المدفوعة توفر نسخًا يومية واستعادة لنقطة زمنية (PITR) حسب الخطة.
- **نسخة مستقلة إضافية** (موصى بها، خارج Render) — من جهاز إداري آمن:
  ```bash
  pg_dump "$EXTERNAL_DATABASE_URL" -Fc --no-owner -f zaki-$(date +%F).dump
  # تشفير قبل التخزين:
  gpg --symmetric --cipher-algo AES256 zaki-$(date +%F).dump
  ```
- **الاستعادة** (إلى قاعدة فارغة):
  ```bash
  createdb zaki_restore
  psql zaki_restore -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
  pg_restore --no-owner -d zaki_restore zaki-YYYY-MM-DD.dump
  ```
- **اختبار الاستعادة دوريًا** إلزامي (مجدول في المرحلة السادسة؛ لم يُختبر بعد).
