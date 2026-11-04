# نشر smart Meet على `meet.startupsmart.net`

موقع الشركة `startupsmart.net` هيفضل زي ما هو. نظام الاجتماعات هيبقى على الفرع:

> **https://meet.startupsmart.net**

المدة المتوقعة: حوالي 30 دقيقة.
التكلفة الشهرية: حوالي **7 دولار** للسيرفر، بالإضافة لاستهلاك الذكاء الاصطناعي.

---

## الخطوة 1: حساب Render ورفع النظام

1. ادخل على **https://render.com** ودوس **Get Started**. سجّل بحساب **GitHub**.
2. من فوق دوس **New +** ← **Blueprint**.
3. اختار المستودع **Zaky**، وبعدين الفرع **`claude/new-project-tnsui6`**. لو دمجته في `main`، اختار `main`.
4. Render هيقرا ملف `render.yaml` لوحده، وهيطلب منك القيم دي:

   | المتغير | القيمة |
   |---|---|
   | `ANTHROPIC_API_KEY` | مفتاح Claude، اللي بيبدأ بـ `sk-ant-` |
   | `TURN_URL` / `TURN_USERNAME` / `TURN_PASSWORD` | من الخطوة 3. لو لسه ما عملتهاش سيبهم فاضيين دلوقتي |

5. دوس **Apply**، واستنى دقيقتين لحد ما الحالة تبقى **Live** ✅.
6. افتح الرابط المؤقت اللي Render بيديهولك، زي `https://smart-meet.onrender.com`، واتأكد إن الصفحة الرئيسية ظاهرة.

> الخطة **Starter** هي اللي حوالي 7 دولار في الشهر. الخطة المجانية بتنام بعد فترة خمول، وده بيقطع الاجتماعات، فما تستخدمهاش.

---

## الخطوة 2: ربط `meet.startupsmart.net`

### أ. في Render
1. افتح خدمة **smart-meet** ← **Settings** ← **Custom Domains**.
2. هتلاقي `meet.startupsmart.net` مضاف، ولو مش موجود دوس **Add Custom Domain** واكتبه.
3. Render هيعرض لك **قيمة CNAME**، غالبًا `smart-meet.onrender.com`. انسخها.

### ب. في cPanel (استضافة startupsmart.net)
1. ادخل cPanel، ومن **Tools** انزل لقسم **Domains** ودوس **Zone Editor**. أو اكتب `Zone Editor` في البحث 🔍.
2. قدام `startupsmart.net` دوس **Manage**.
3. دوس **+ Add Record** ← **Add CNAME Record**:
   - **Name:** `meet` (هيكمّلها لوحده لـ `meet.startupsmart.net.`)
   - **Record:** `smart-meet.onrender.com` (القيمة اللي نسخها من Render بالظبط)
4. **Save Record**.

> لو ظهرلك خطأ إن `meet` موجود قبل كده، امسح السجل القديم الأول. ولو فيه **Subdomain** اسمه `meet` معمول من صفحة **Domains**، امسحه هو كمان.
> ما تشغّلش النظام على cPanel نفسه، لأن الاستضافة المشتركة ما بتدعمش الاتصال المستمر اللي الاجتماعات محتاجاه. cPanel هنا للدومين بس.

### ب (بديل). لو الدومين مش متدار من cPanel
لو مش عارف الدومين مسجّل فين، اكتب `startupsmart.net` في الموقع ده: **https://lookup.icann.org**. هيقولك اسم الشركة المسجّل عندها (Registrar)، والـ Name Servers. لو الـ Name Servers فيها كلمة `cloudflare`، يبقى الإعدادات من Cloudflare.

ضيف سجل جديد بالشكل ده:

| النوع (Type) | الاسم (Name / Host) | القيمة (Value / Target) | TTL |
|---|---|---|---|
| `CNAME` | `meet` | `smart-meet.onrender.com` (اللي نسخته من Render) | Auto أو 3600 |

> **لو الـ DNS على Cloudflare:** خلّي السحابة البرتقالي **رمادي (DNS only)**، علشان شهادة HTTPS تطلع صح.

### ج. التأكيد
- ارجع لـ Render ودوس **Verify**. ممكن الربط ياخد من 5 دقايق لساعة.
- Render هيطلّع شهادة **HTTPS** لوحده، ومن غيرها الكاميرا والميكروفون ما يشتغلوش.

---

## الخطوة 3: سيرفر TURN (علشان الاتصال يشتغل على كل الشبكات)

من غيره، بعض الناس اللي على نت الموبايل أو شبكات الشركات مش هيشوفوا أو يسمعوا بعض.

أسهل طريقة هي خدمة **Metered**:
1. سجّل على **https://www.metered.ca/stun-turn**.
2. اعمل App، وخد منها **TURN URL** و **Username** و **Password**.
3. حطهم في Render ← **Environment**:
   - `TURN_URL`: ممكن أكتر من عنوان بينهم فاصلة، مثلاً:
     `turn:global.relay.metered.ca:80,turn:global.relay.metered.ca:443,turns:global.relay.metered.ca:443?transport=tcp`
   - `TURN_USERNAME` و `TURN_PASSWORD`
4. **Save Changes**، والخدمة هتعيد تشغيل نفسها.

> فيه بدائل زي Cloudflare Calls TURN أو Twilio، أو تنصّب **coturn** على سيرفر خاص.

---

## الخطوة 4: التجربة النهائية

1. افتح **https://meet.startupsmart.net** من الموبايل، واعمل اجتماع جديد.
2. ابعت رابط الدعوة لزميل **على شبكة مختلفة**، مثلاً نت الموبايل.
3. اتأكدوا من الحاجات دي:
   - [ ] الفيديو والصوت شغالين في الاتجاهين
   - [ ] مشاركة الشاشة (من الكمبيوتر)
   - [ ] المحادثة، ورفع اليد، والتفاعلات
   - [ ] الترجمة: فعّل "تحويل كلامي إلى نص" من Chrome واتكلم، وخلّي الزميل يختار ترجمة لـ English
   - [ ] المساعد الذكي: دوس "لخّص الاجتماع"
   - [ ] التسجيل وتحميل المحضر
4. من الموبايل تقدر تضيف الموقع للشاشة الرئيسية (**Add to Home Screen**)، وهيظهر كتطبيق بأيقونة ذكي.

---

## بعد النشر

- **أي تعديل** يترفع على الفرع اللي اخترته، Render بينشره لوحده.
- **الاستهلاك:** تابع استهلاك الذكاء الاصطناعي من **https://console.anthropic.com**، واعمل حد أقصى للصرف الشهري.
- **السجلات (Logs):** من Render ← **Logs**. لما الخادم يشتغل، لازم تلاقي السطر ده:
  `AI services: ON (assistant: claude-opus-5-5, translation: claude-haiku-5-5)`
