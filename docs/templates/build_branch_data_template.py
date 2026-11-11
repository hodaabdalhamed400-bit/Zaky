"""قالب Excel لجمع بيانات الفروع (الوحدات، العملاء، العقود، السداد) بصيغة مطابقة لنظام ZAKI ERP."""
import sys
from datetime import date
from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = sys.argv[1]
ONE = sys.argv[2] if len(sys.argv) > 2 else None  # نسخة خاصة بفرع واحد

BRANCHES = ["الازدهار", "النفل", "جامعة الإمام", "المركز", "الروضة", "السويدي", "تبوك", "غرناطة مول", "لافالي 2", "حطين", "الملقا"]
UNIT_TYPES = ["مكتب خاص", "مكتب مشترك", "قاعة اجتماعات", "مساحة إدارية"]
PRICING = ["شهري", "سنوي", "يومي", "بالساعة"]
UNIT_STATUS = ["متاحة", "مؤجرة", "صيانة", "غير نشطة"]
TENANT_TYPES = ["منشأة", "فرد"]
TENANT_STATUS = ["نشط", "سابق", "محتمل"]
CYCLES = ["شهري", "ربع سنوي", "نصف سنوي", "سنوي"]

NAVY, CYAN = "132E4B", "1EADC0"
F = "Arial"
HEAD_FILL = PatternFill("solid", fgColor=NAVY)
INPUT_FILL = PatternFill("solid", fgColor="FFF9DB")  # أصفر فاتح = خانات التعبئة
AUTO_FILL = PatternFill("solid", fgColor="E6ECF2")  # رمادي مزرق = تلقائي
EXAMPLE_FILL = PatternFill("solid", fgColor="F2F2F2")
thin = Side(style="thin", color="D0D7DE")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
HEAD_ROW, EX_ROW, FIRST = 3, 4, 5

wb = Workbook()


def rtl(ws):
    ws.sheet_view.rightToLeft = True
    ws.sheet_view.showGridLines = False


def lists_sheet():
    ws = wb.create_sheet("القوائم")
    cols = [("الفروع", BRANCHES), ("أنواع الوحدات", UNIT_TYPES), ("دورة التسعير", PRICING), ("حالة الوحدة", UNIT_STATUS),
            ("نوع العميل", TENANT_TYPES), ("حالة العميل", TENANT_STATUS), ("دورة الدفع", CYCLES)]
    refs = {}
    for i, (title, values) in enumerate(cols, start=1):
        c = get_column_letter(i)
        ws[f"{c}1"] = title
        ws[f"{c}1"].font = Font(name=F, bold=True)
        for r, v in enumerate(values, start=2):
            ws[f"{c}{r}"] = v
            ws[f"{c}{r}"].font = Font(name=F)
        refs[title] = f"القوائم!${c}$2:${c}${len(values) + 1}"
        ws.column_dimensions[c].width = 18
    rtl(ws)
    ws.sheet_state = "hidden"
    return refs


def data_sheet(name, title, subtitle, columns, rows, example):
    """columns: (header, width, kind, extra) — kind: input | auto ; extra: dict(fmt, list, formula, note, required)"""
    ws = wb.create_sheet(name)
    rtl(ws)
    last_col = get_column_letter(len(columns))
    ws.merge_cells(f"A1:{last_col}1")
    ws["A1"] = title
    ws["A1"].font = Font(name=F, size=14, bold=True, color=NAVY)
    ws.merge_cells(f"A2:{last_col}2")
    ws["A2"] = subtitle
    ws["A2"].font = Font(name=F, size=10, color="52514E")
    ws.row_dimensions[1].height = 26
    ws.row_dimensions[2].height = 30
    ws["A2"].alignment = Alignment(wrap_text=True, vertical="top", horizontal="right")
    last = FIRST + rows - 1

    for i, (header, width, kind, extra) in enumerate(columns, start=1):
        col = get_column_letter(i)
        ws.column_dimensions[col].width = width
        h = ws.cell(HEAD_ROW, i, header + (" *" if extra.get("required") else ""))
        h.font = Font(name=F, bold=True, color="FFFFFF")
        h.fill = HEAD_FILL if kind == "input" else PatternFill("solid", fgColor="4A6683")
        h.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        h.border = BORDER
        if extra.get("note"):
            h.comment = Comment(extra["note"], "ZAKI ERP")
        fmt = extra.get("fmt")
        # صف المثال
        ex = ws.cell(EX_ROW, i, example[i - 1])
        ex.font = Font(name=F, italic=True, color="7A7A7A")
        ex.fill = EXAMPLE_FILL
        ex.border = BORDER
        ex.alignment = Alignment(horizontal="right", vertical="center")
        if fmt:
            ex.number_format = fmt
        # خانات البيانات
        for r in range(FIRST, last + 1):
            c = ws.cell(r, i)
            c.font = Font(name=F)
            c.border = BORDER
            c.alignment = Alignment(horizontal="right", vertical="center")
            if fmt:
                c.number_format = fmt
            if kind == "input":
                c.fill = INPUT_FILL
            else:
                c.fill = AUTO_FILL
                c.font = Font(name=F, color="1F3B57")
                if extra.get("formula"):
                    c.value = extra["formula"].format(r=r)
        if kind == "auto" and extra.get("formula") and isinstance(example[i - 1], str) and example[i - 1].startswith("="):
            pass
        if extra.get("list"):
            dv = DataValidation(type="list", formula1=f"={extra['list']}", allow_blank=True, showErrorMessage=True,
                                errorTitle="قيمة غير صحيحة", error="اختر من القائمة المنسدلة")
            ws.add_data_validation(dv)
            dv.add(f"{col}{FIRST}:{col}{last}")
        if extra.get("validate"):
            formula, msg = extra["validate"]
            dv = DataValidation(type="custom", formula1=formula, allow_blank=True, showErrorMessage=True,
                                errorStyle="warning", errorTitle="تحقق من القيمة", error=msg)
            ws.add_data_validation(dv)
            dv.add(f"{col}{FIRST}:{col}{last}")
        if extra.get("dv"):
            dv = extra["dv"]
            ws.add_data_validation(dv)
            dv.add(f"{col}{FIRST}:{col}{last}")
    ws.cell(EX_ROW, 1).comment = Comment("صف مثال للتوضيح فقط — لا يُستورد. ابدأ التعبئة من الصف التالي.", "ZAKI ERP")
    ws.row_dimensions[HEAD_ROW].height = 42
    ws.freeze_panes = ws.cell(FIRST, 1)
    ws.auto_filter.ref = f"A{HEAD_ROW}:{last_col}{last}"
    return ws, last


L = lists_sheet()


def branch_col(width, trigger, header="الفرع"):
    """في نسخة الفرع: عمود الفرع يُملأ تلقائيًا عند تعبئة السطر. في النسخة العامة: قائمة منسدلة."""
    if ONE:
        return (header + " (تلقائي)", width, "auto", {"formula": f'=IF({trigger}{{r}}="","","{ONE}")'})
    return (header, width, "input", {"list": L["الفروع"], "required": True})



def positive(label):
    return DataValidation(type="decimal", operator="greaterThan", formula1="0", allow_blank=True, showErrorMessage=True,
                          errorTitle="رقم غير صحيح", error=f"{label}: أدخل رقمًا أكبر من صفر")


def whole(label, lo=1, hi=1000):
    return DataValidation(type="whole", operator="between", formula1=str(lo), formula2=str(hi), allow_blank=True, showErrorMessage=True,
                          errorTitle="رقم غير صحيح", error=f"{label}: أدخل عددًا صحيحًا من {lo} إلى {hi}")


def a_date():
    return DataValidation(type="date", operator="between", formula1="DATE(2015,1,1)", formula2="DATE(2040,12,31)", allow_blank=True,
                          showErrorMessage=True, errorTitle="تاريخ غير صحيح", error="أدخل التاريخ بصيغة يوم/شهر/سنة، مثل 01/01/2026")


MONEY = "#,##0.00"
DATE = "dd/mm/yyyy"

# ───── الوحدات ─────
units, U_LAST = data_sheet(
    "الوحدات",
    "1) المكاتب والوحدات",
    "سطر لكل مكتب أو وحدة أو قاعة في الفرع، سواء كانت مؤجرة أو متاحة. رقم الوحدة لا يتكرر داخل نفس الفرع.",
    [
        branch_col(16, "B"),
        ("رقم الوحدة / المكتب", 16, "input", {"required": True, "fmt": "@", "note": "كما هو مكتوب على باب المكتب، مثل 101 أو A-12 أو قاعة 1"}),
        ("نوع الوحدة", 16, "input", {"list": L["أنواع الوحدات"], "required": True, "note": "قاعة الاجتماعات تُحجز بالساعة ولا تحتاج عقدًا"}),
        ("الدور", 10, "input", {"fmt": "@"}),
        ("المساحة م²", 11, "input", {"fmt": "#,##0.00", "dv": positive("المساحة")}),
        ("السعة (عدد المقاعد)", 12, "input", {"required": True, "fmt": "0", "dv": whole("السعة"), "note": "عدد الأشخاص/المقاعد. للمكتب المشترك = عدد المقاعد القابلة للتأجير"}),
        ("السعر الأساسي شامل الضريبة (ر.س)", 18, "input", {"required": True, "fmt": MONEY, "dv": positive("السعر"), "note": "سعر القائمة للوحدة حسب دورة التسعير، شامل ضريبة 15%"}),
        ("دورة التسعير", 12, "input", {"list": L["دورة التسعير"], "required": True, "note": "المكاتب غالبًا شهري، والقاعات بالساعة"}),
        ("الحالة الحالية", 13, "input", {"list": L["حالة الوحدة"], "required": True}),
        ("السعر قبل الضريبة (تلقائي)", 16, "auto", {"fmt": MONEY, "formula": '=IF(G{r}="","",ROUND(G{r}/1.15,2))'}),
        ("ملاحظات", 30, "input", {}),
    ],
    500,
    [ONE or "الازدهار", "101", "مكتب خاص", "الأول", 20, 4, 3450, "شهري", "مؤجرة", "=ROUND(G4/1.15,2)", "مطل على الشارع"],
)
units.conditional_formatting.add(
    f"A{FIRST}:B{U_LAST}",
    FormulaRule(formula=[f'AND($B{FIRST}<>"",COUNTIFS($A${FIRST}:$A${U_LAST},$A{FIRST},$B${FIRST}:$B${U_LAST},$B{FIRST})>1)'],
                fill=PatternFill("solid", fgColor="F8D7DA"), font=Font(name=F, color="9B1C1C", bold=True)),
)

# ───── العملاء ─────
tenants, T_LAST = data_sheet(
    "العملاء",
    "2) العملاء (المستأجرون)",
    "سطر لكل عميل مرة واحدة فقط، حتى لو عنده أكثر من مكتب أو عقد. اسم العميل لا يتكرر.",
    [
        ("اسم العميل / المنشأة", 28, "input", {"required": True, "note": "الاسم الرسمي كما في السجل التجاري أو الهوية"}),
        ("نوع العميل", 11, "input", {"list": L["نوع العميل"], "required": True}),
        branch_col(15, "A", "الفرع الأساسي"),
        ("اسم الشخص المسؤول", 20, "input", {}),
        ("الجوال", 14, "input", {"required": True, "fmt": "@", "validate": (f'AND(LEN(E{FIRST})=10,LEFT(E{FIRST},2)="05")', "رقم الجوال 10 أرقام ويبدأ بـ 05"), "note": "10 أرقام يبدأ بـ 05 — يُستخدم لتذكير واتساب"}),
        ("البريد الإلكتروني", 24, "input", {"fmt": "@", "validate": (f'ISNUMBER(SEARCH("@",F{FIRST}))', "البريد الإلكتروني غير صحيح")}),
        ("السجل التجاري", 15, "input", {"fmt": "@", "note": "للمنشآت"}),
        ("الرقم الضريبي", 18, "input", {"fmt": "@", "validate": (f'AND(LEN(H{FIRST})=15,LEFT(H{FIRST},1)="3",RIGHT(H{FIRST},1)="3")', "الرقم الضريبي 15 رقمًا يبدأ وينتهي بـ 3"), "note": "15 رقمًا يبدأ وينتهي بالرقم 3"}),
        ("رقم الهوية (اختياري)", 15, "input", {"fmt": "@", "note": "للأفراد فقط. اختياري — يُفضّل تركه فارغًا حاليًا"}),
        ("العنوان الوطني", 26, "input", {}),
        ("حالة العميل", 11, "input", {"list": L["حالة العميل"], "required": True, "note": "نشط = عنده عقد حالي. سابق = انتهى عقده. محتمل = لم يتعاقد بعد"}),
        ("ملاحظات", 30, "input", {}),
    ],
    500,
    ["شركة المثال للتقنية", "منشأة", ONE or "الازدهار", "أحمد محمد", "0551234567", "info@example.sa", "1010123456", "300000000000003", "", "الرياض، حي الازدهار", "نشط", ""],
)
tenants.conditional_formatting.add(
    f"A{FIRST}:A{T_LAST}",
    FormulaRule(formula=[f'AND($A{FIRST}<>"",COUNTIF($A${FIRST}:$A${T_LAST},$A{FIRST})>1)'],
                fill=PatternFill("solid", fgColor="F8D7DA"), font=Font(name=F, color="9B1C1C", bold=True)),
)

# ───── العقود ─────
CL = 1000
contracts, C_LAST = data_sheet(
    "العقود",
    "3) العقود السارية",
    "سطر لكل وحدة داخل العقد. العقد الذي يشمل أكثر من مكتب: كرر نفس «رقم مرجع العقد» في عدة سطور (سطر لكل مكتب). العميل والوحدة يجب أن يكونا مسجلين في الشيتين السابقين.",
    [
        ("رقم مرجع العقد", 12, "input", {"required": True, "fmt": "0", "dv": whole("رقم المرجع", 1, 100000), "note": "رقم بسيط تختاره (1، 2، 3...) يربط سطور العقد الواحد ببعضها وبشيت السداد"}),
        ("رقم العقد الورقي (إن وجد)", 16, "input", {"fmt": "@"}),
        ("اسم العميل", 26, "input", {"required": True, "list": f"العملاء!$A${FIRST}:$A${T_LAST}", "note": "اختر من القائمة — تظهر أسماء العملاء المسجلين في شيت العملاء"}),
        branch_col(15, "C"),
        ("رقم الوحدة", 13, "input", {"required": True, "fmt": "@", "validate": (f"COUNTIFS(الوحدات!$A${FIRST}:$A${U_LAST},D{FIRST},الوحدات!$B${FIRST}:$B${U_LAST},E{FIRST})>0", "هذه الوحدة غير مسجلة في شيت الوحدات لنفس الفرع")}),
        ("عدد المقاعد", 10, "input", {"fmt": "0", "dv": whole("عدد المقاعد"), "note": "للمكتب المشترك فقط: عدد المقاعد المؤجرة لهذا العميل. للمكتب الخاص اتركه فارغًا"}),
        ("الإيجار الشهري للوحدة شامل الضريبة (ر.س)", 18, "input", {"required": True, "fmt": MONEY, "dv": positive("الإيجار الشهري"), "note": "المبلغ الشهري المتفق عليه لهذه الوحدة، شامل ضريبة 15%"}),
        ("تاريخ بداية العقد", 14, "input", {"required": True, "fmt": DATE, "dv": a_date(), "note": "القسط يستحق في نفس يوم البداية من كل دورة دفع"}),
        ("مدة العقد (بالأشهر)", 11, "input", {"required": True, "fmt": "0", "dv": whole("المدة", 1, 120)}),
        ("تاريخ النهاية (تلقائي)", 14, "auto", {"fmt": DATE, "formula": '=IF(OR(H{r}="",I{r}=""),"",EDATE(H{r},I{r})-1)'}),
        ("دورة الدفع", 12, "input", {"list": L["دورة الدفع"], "required": True}),
        ("قيمة القسط (تلقائي)", 15, "auto", {"fmt": MONEY, "formula": '=IF(OR(G{r}="",K{r}=""),"",G{r}*IF(K{r}="شهري",1,IF(K{r}="ربع سنوي",3,IF(K{r}="نصف سنوي",6,12))))'}),
        ("إجمالي قيمة الوحدة في العقد (تلقائي)", 17, "auto", {"fmt": MONEY, "formula": '=IF(OR(G{r}="",I{r}=""),"",G{r}*I{r})'}),
        ("ملاحظات (شروط خاصة)", 30, "input", {}),
    ],
    CL,
    [1, "", "شركة المثال للتقنية", ONE or "الازدهار", "101", "", 3450, date(2026, 1, 1), 12, "=EDATE(H4,I4)-1", "ربع سنوي", "=G4*3", "=G4*I4", ""],
)

# ───── السداد ─────
pay, P_LAST = data_sheet(
    "السداد",
    "4) موقف السداد لكل عقد",
    "سطر واحد لكل عقد (برقم المرجع نفسه المستخدم في شيت العقود): كم دفع العميل حتى اليوم، وهل عليه متأخرات.",
    [
        ("رقم مرجع العقد", 12, "input", {"required": True, "fmt": "0", "validate": (f"COUNTIF(العقود!$A${FIRST}:$A${C_LAST},A{FIRST})>0", "رقم المرجع غير موجود في شيت العقود")}),
        ("اسم العميل (تلقائي)", 26, "auto", {"formula": f'=IF(A{{r}}="","",IFERROR(INDEX(العقود!$C${FIRST}:$C${C_LAST},MATCH(A{{r}},العقود!$A${FIRST}:$A${C_LAST},0)),"غير موجود في العقود"))'}),
        ("إجمالي قيمة العقد (تلقائي)", 17, "auto", {"fmt": MONEY, "formula": f'=IF(A{{r}}="","",SUMIF(العقود!$A${FIRST}:$A${C_LAST},A{{r}},العقود!$M${FIRST}:$M${C_LAST}))'}),
        ("إجمالي المسدد حتى اليوم (ر.س)", 17, "input", {"required": True, "fmt": MONEY, "dv": DataValidation(type="decimal", operator="greaterThanOrEqual", formula1="0", allow_blank=True, showErrorMessage=True, errorTitle="رقم غير صحيح", error="أدخل المبلغ المسدد (صفر أو أكثر)")}),
        ("المتبقي من العقد (تلقائي)", 17, "auto", {"fmt": MONEY, "formula": '=IF(A{r}="","",C{r}-D{r})'}),
        ("آخر قسط تم سداده (تاريخ استحقاقه)", 17, "input", {"fmt": DATE, "dv": a_date(), "note": "تاريخ استحقاق آخر قسط دفعه العميل بالكامل"}),
        ("المتأخر حاليًا (ر.س)", 15, "input", {"fmt": MONEY, "note": "أقساط حلّ موعدها ولم تُدفع حتى اليوم. اكتب 0 إن لم يوجد"}),
        ("ملاحظات", 30, "input", {}),
    ],
    500,
    [1, "=العقود!C4", "=العقود!M4", 10350, "=C4-D4", date(2026, 1, 1), 0, "دفع القسط الأول نقدًا"],
)
pay.conditional_formatting.add(
    f"E{FIRST}:E{P_LAST}",
    FormulaRule(formula=[f'AND(ISNUMBER(E{FIRST}),E{FIRST}<0)'], fill=PatternFill("solid", fgColor="F8D7DA"), font=Font(name=F, color="9B1C1C", bold=True)),
)

# ───── الملخص ─────
s = wb.create_sheet("الملخص")
rtl(s)
s.merge_cells("A1:H1")
s["A1"] = "ملخص المراجعة لكل فرع (تلقائي — لا يحتاج تعبئة)"
s["A1"].font = Font(name=F, size=14, bold=True, color=NAVY)
s.merge_cells("A2:H2")
s["A2"] = "راجعه قبل إرسال الملف: الوحدات المؤجرة يجب أن يقابلها عقود، وكل عقد له سطر في شيت السداد."
s["A2"].font = Font(name=F, size=10, color="52514E")
heads = ["الفرع", "عدد الوحدات", "المؤجرة", "المتاحة", "عدد العملاء", "سطور العقود (وحدات بعقود)", "إجمالي الإيجار الشهري (ر.س)", "مؤجرة بدون عقد"]
widths = [16, 12, 10, 10, 12, 16, 20, 14]
for i, (h, w) in enumerate(zip(heads, widths), start=1):
    c = s.cell(3, i, h)
    c.font = Font(name=F, bold=True, color="FFFFFF")
    c.fill = HEAD_FILL
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.border = BORDER
    s.column_dimensions[get_column_letter(i)].width = w
s.row_dimensions[3].height = 36
U, T, C = f"$A${FIRST}:$A${U_LAST}", f"$C${FIRST}:$C${T_LAST}", f"$D${FIRST}:$D${C_LAST}"
SUMMARY = [ONE] if ONE else BRANCHES
for k, b in enumerate(SUMMARY):
    r = 4 + k
    vals = [
        b,
        f"=COUNTIFS(الوحدات!{U},A{r},الوحدات!$B${FIRST}:$B${U_LAST},\"<>\")",
        f"=COUNTIFS(الوحدات!{U},A{r},الوحدات!$I${FIRST}:$I${U_LAST},\"مؤجرة\")",
        f"=COUNTIFS(الوحدات!{U},A{r},الوحدات!$I${FIRST}:$I${U_LAST},\"متاحة\")",
        f"=COUNTIF(العملاء!{T},A{r})",
        f"=COUNTIF(العقود!{C},A{r})",
        f"=SUMIF(العقود!{C},A{r},العقود!$G${FIRST}:$G${C_LAST})",
        f"=MAX(0,C{r}-F{r})",
    ]
    for i, v in enumerate(vals, start=1):
        c = s.cell(r, i, v)
        c.font = Font(name=F, bold=(i == 1))
        c.border = BORDER
        c.alignment = Alignment(horizontal="right" if i == 1 else "center")
        if i == 7:
            c.number_format = MONEY
tr = 4 + len(SUMMARY)
s.cell(tr, 1, "الإجمالي").font = Font(name=F, bold=True, color="FFFFFF")
for i in range(1, 9):
    c = s.cell(tr, i)
    c.fill = PatternFill("solid", fgColor="4A6683")
    c.border = BORDER
    c.alignment = Alignment(horizontal="center")
    if i > 1:
        col = get_column_letter(i)
        c.value = f"=SUM({col}4:{col}{tr - 1})"
        c.font = Font(name=F, bold=True, color="FFFFFF")
        if i == 7:
            c.number_format = MONEY
s.conditional_formatting.add(f"H4:H{tr - 1}", FormulaRule(formula=["H4>0"], fill=PatternFill("solid", fgColor="FDECC8"), font=Font(name=F, color="8A5300", bold=True)))
s.cell(tr + 2, 1, "«مؤجرة بدون عقد» أكبر من صفر يعني وحدات حالتها مؤجرة ولم يُسجَّل لها عقد في شيت العقود — راجعها.").font = Font(name=F, size=10, italic=True, color="52514E")

# ───── التعليمات ─────
ins = wb.active
ins.title = "التعليمات"
rtl(ins)
ins.column_dimensions["A"].width = 4
ins.column_dimensions["B"].width = 110
lines = [
    ("title", f"بيانات فرع {ONE} — ZAKI Smart ERP" if ONE else "قالب بيانات الفروع — ZAKI Smart ERP"),
    ("sub", f"شركة ذكي لحاضنات ومسرعات الأعمال · هذا الملف خاص بفرع {ONE} فقط — عمود الفرع يُملأ تلقائيًا" if ONE else "شركة ذكي لحاضنات ومسرعات الأعمال · يُعبأ من مدير كل فرع ويُرسل لإدارة النظام لإدخاله دفعة واحدة"),
    ("", ""),
    ("h", "ترتيب التعبئة"),
    ("p", "1) شيت «الوحدات»: كل المكاتب والوحدات والقاعات في الفرع (المؤجرة والمتاحة)."),
    ("p", "2) شيت «العملاء»: كل عميل مرة واحدة فقط."),
    ("p", "3) شيت «العقود»: العقود السارية — سطر لكل مكتب داخل العقد. اسم العميل يُختار من القائمة."),
    ("p", "4) شيت «السداد»: سطر لكل عقد: كم دفع حتى اليوم وكم عليه متأخر."),
    ("p", "5) شيت «الملخص»: يتحدث تلقائيًا — راجعه قبل الإرسال."),
    ("", ""),
    ("h", "دليل الألوان"),
    ("legend_in", "خانة صفراء = تعبئة من الموظف"),
    ("legend_auto", "خانة رمادية مزرقة = تُحسب تلقائيًا — لا تكتب فيها"),
    ("legend_ex", "الصف الرمادي الأول في كل شيت = مثال للتوضيح فقط، لا يُستورد. ابدأ من الصف الذي بعده"),
    ("p", "العمود المكتوب بجانب عنوانه * إلزامي. مرّر الماوس على العناوين التي بها مثلث أحمر لقراءة الشرح."),
    ("", ""),
    ("h", "قواعد مهمة"),
    ("p", "• كل المبالغ بالريال السعودي وشاملة ضريبة القيمة المضافة 15% (كما في العقد)."),
    ("p", "• التواريخ بصيغة يوم/شهر/سنة، مثل 01/01/2026."),
    ("p", "• الجوال 10 أرقام يبدأ بـ 05 (مهم لتذكيرات واتساب). الرقم الضريبي 15 رقمًا يبدأ وينتهي بـ 3."),
    ("p", "• رقم الوحدة لا يتكرر داخل نفس الفرع، واسم العميل لا يتكرر — المكرر يظهر باللون الأحمر."),
    ("p", "• قاعات الاجتماعات تُسجل في شيت الوحدات فقط (نوع: قاعة اجتماعات، دورة التسعير: بالساعة) ولا تحتاج عقودًا."),
    ("p", "• المكتب المشترك: سجّل في الوحدات عدد مقاعده الكلي، وفي العقود عدد المقاعد المؤجرة لكل عميل."),
    ("p", "• رقم الهوية الوطنية اختياري، ويُفضّل تركه فارغًا حاليًا."),
    ("p", "• لا تغيّر أسماء الشيتات ولا عناوين الأعمدة ولا ترتيبها — حتى يُدخل الملف للنظام تلقائيًا."),
    ("p", f"• هذا الملف لفرع {ONE} فقط. عميل مسجل في فرع آخر يُكتب هنا فقط إن كان له عقد في هذا الفرع." if ONE else "• يمكن لكل فرع تعبئة نسخة مستقلة من الملف، أو تعبئة ملف واحد لكل الفروع."),
    ("", ""),
    ("h", "عند الانتهاء"),
    ("p", "احفظ الملف بعد التعبئة وأرسله لإدارة النظام على الخاص. لا ترسل الملف في مجموعات عامة لأنه يحتوي بيانات عملاء." if ONE else "احفظ الملف باسم الفرع (مثل: بيانات-الازدهار.xlsx) وأرسله لإدارة النظام. لا ترسل الملف في مجموعات عامة لأنه يحتوي بيانات عملاء."),
]
r = 1
for kind, text in lines:
    c = ins.cell(r, 2, text)
    c.alignment = Alignment(horizontal="right", vertical="center", wrap_text=True)
    if kind == "title":
        c.font = Font(name=F, size=18, bold=True, color=NAVY)
        ins.row_dimensions[r].height = 32
    elif kind == "sub":
        c.font = Font(name=F, size=11, color="52514E")
    elif kind == "h":
        c.font = Font(name=F, size=13, bold=True, color="FFFFFF")
        c.fill = HEAD_FILL
        ins.row_dimensions[r].height = 22
    elif kind.startswith("legend"):
        c.font = Font(name=F, size=11)
        c.fill = {"legend_in": INPUT_FILL, "legend_auto": AUTO_FILL, "legend_ex": EXAMPLE_FILL}[kind]
        c.border = BORDER
    else:
        c.font = Font(name=F, size=11)
    r += 1

wb.move_sheet("القوائم", offset=len(wb.sheetnames))
wb.active = 0
wb.save(OUT)
print("saved", OUT)
