import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, makeActor } from "./helpers";
import {
  approvePurchase,
  createCategory,
  createPurchase,
  getPurchase,
  listPurchases,
  markPurchasePaid,
  markPurchaseUnpaid,
  rejectPurchase,
  setCategoryActive,
  suggestVat,
  updatePurchase,
} from "@/services/purchases.service";
import { deleteDocument } from "@/services/documents.service";
import { addDays, todayInRiyadh } from "@/lib/dates";

const TODAY = todayInRiyadh();
const PDF = new TextEncoder().encode("%PDF-1.4\n%invoice\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const file = () => ({ name: "فاتورة.pdf", size: PDF.length, bytes: PDF });

async function setup() {
  const code = `Q${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "Y")}`;
  const branch = await prisma.branch.create({ data: { code, nameAr: `فرع مشتريات ${randomUUID().slice(0, 6)}` } });
  const other = await prisma.branch.create({ data: { code: `R${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "Y")}`, nameAr: `فرع آخر ${randomUUID().slice(0, 6)}` } });
  const { actor: manager } = await makeActor("BRANCH_MANAGER", { branchCodes: [code] });
  const { actor: accountant } = await makeActor("ACCOUNTANT", { branchCodes: [code] });
  const category = await prisma.expenseCategory.findFirstOrThrow({ where: { nameAr: "صيانة وإصلاحات" } });
  return { branch, other, manager, accountant, category };
}

const input = (branchId: string, categoryId: string, over: Record<string, unknown> = {}) => ({
  branchId,
  categoryId,
  supplierName: `مؤسسة الصيانة ${randomUUID().slice(0, 6)}`,
  supplierVatNo: "300000000000003",
  invoiceNo: `INV-${randomUUID().slice(0, 8)}`,
  invoiceDate: TODAY,
  totalAmount: "1,150.00",
  vatAmount: "150.00",
  description: "صيانة مكيف",
  ...over,
});

describe("فواتير الشراء", () => {
  it("الضريبة المقترحة 15% من مبلغ شامل الضريبة", () => {
    expect(suggestVat("115").toFixed(2)).toBe("15.00");
    expect(suggestVat("1000").toFixed(2)).toBe("130.43");
    expect(suggestVat("0.10").toFixed(2)).toBe("0.01");
  });

  it("مدير الفرع يضيف فاتورة بصورتها: رقم داخلي من تسلسل الفرع، والصافي = الإجمالي − الضريبة، وتنبيه للمحاسب", async () => {
    const { branch, manager, accountant, category } = await setup();
    const { invoice, uploadError } = await createPurchase(prisma, manager, input(branch.id, category.id), file());
    expect(uploadError).toBeNull();
    expect(invoice.refNo).toBe(`PI-${branch.code}-${TODAY.slice(0, 4)}-00001`);
    expect(invoice.status).toBe("PENDING_REVIEW");
    expect(invoice.totalAmount.toFixed(2)).toBe("1150.00");
    expect(invoice.netAmount.toFixed(2)).toBe("1000.00");
    expect(await prisma.document.count({ where: { purchaseInvoiceId: invoice.id, category: "PURCHASE_INVOICE" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: accountant.id, type: "PURCHASE_PENDING_REVIEW", entityId: invoice.id } })).toBe(1);
    const log = await prisma.auditLog.findFirst({ where: { action: "purchase.create", entityId: invoice.id } });
    expect(log?.userId).toBe(manager.id);
  });

  it("رفض المدخلات غير الصحيحة: بدون صورة، ضريبة أكبر من الإجمالي، تاريخ مستقبلي، رقم ضريبي خاطئ", async () => {
    const { branch, manager, category } = await setup();
    await expect(createPurchase(prisma, manager, input(branch.id, category.id), null)).rejects.toThrow(/اختر ملفًا/);
    const html = new TextEncoder().encode("<html>x</html>");
    await expect(createPurchase(prisma, manager, input(branch.id, category.id), { name: "a.pdf", size: html.length, bytes: html })).rejects.toThrow(/نوع الملف/);
    await expect(createPurchase(prisma, manager, input(branch.id, category.id, { vatAmount: "2000" }), file())).rejects.toThrow(/لا يمكن أن يتجاوز/);
    await expect(createPurchase(prisma, manager, input(branch.id, category.id, { invoiceDate: addDays(TODAY, 1) }), file())).rejects.toThrow(/المستقبل/);
    await expect(createPurchase(prisma, manager, input(branch.id, category.id, { supplierVatNo: "12345" }), file())).rejects.toThrow(/15 رقمًا/);
    expect(await prisma.purchaseInvoice.count({ where: { branchId: branch.id } })).toBe(0);
  });

  it("مورد غير مسجل في الضريبة: ضريبة صفر مسموحة", async () => {
    const { branch, manager, category } = await setup();
    const { invoice } = await createPurchase(prisma, manager, input(branch.id, category.id, { supplierVatNo: "", vatAmount: "0" }), file());
    expect(invoice.vatAmount.toFixed(2)).toBe("0.00");
    expect(invoice.netAmount.toFixed(2)).toBe("1150.00");
  });

  it("منع تكرار نفس فاتورة المورد (حتى باختلاف حالة الأحرف)، ويُسمح بها بعد إرجاع الأصلية", async () => {
    const { branch, manager, accountant, category } = await setup();
    const data = input(branch.id, category.id);
    const { invoice } = await createPurchase(prisma, manager, data, file());
    await expect(createPurchase(prisma, manager, { ...data, invoiceNo: data.invoiceNo.toLowerCase(), supplierName: ` ${data.supplierName} ` }, file())).rejects.toThrow(/مسجلة مسبقًا/);
    await rejectPurchase(prisma, accountant, invoice.id, "صورة غير واضحة");
    const again = await createPurchase(prisma, manager, data, file());
    expect(again.invoice.status).toBe("PENDING_REVIEW");
  });

  it("الصلاحيات: مدير الفرع لا يضيف لفرع آخر ولا يعتمد، والمحاسب يعتمد", async () => {
    const { branch, other, manager, accountant, category } = await setup();
    await expect(createPurchase(prisma, manager, input(other.id, category.id), file())).rejects.toThrow();
    const { invoice } = await createPurchase(prisma, manager, input(branch.id, category.id), file());
    await expect(approvePurchase(prisma, manager, invoice.id)).rejects.toThrow();
    const { actor: outsider } = await makeActor("ACCOUNTANT", { branchCodes: [other.code] });
    await expect(getPurchase(prisma, outsider, invoice.id)).rejects.toThrow();
    const a = await approvePurchase(prisma, accountant, invoice.id);
    expect(a.status).toBe("APPROVED");
    expect(a.approvedById).toBe(accountant.id);
  });

  it("لا اعتماد بدون صورة الفاتورة", async () => {
    const { branch, manager, accountant, category } = await setup();
    const { invoice } = await createPurchase(prisma, manager, input(branch.id, category.id), file());
    const doc = await prisma.document.findFirstOrThrow({ where: { purchaseInvoiceId: invoice.id } });
    await deleteDocument(prisma, manager, doc.id);
    await expect(approvePurchase(prisma, accountant, invoice.id)).rejects.toThrow(/صورة الفاتورة/);
  });

  it("الفاتورة المرجَعة تُعدَّل وتعود للمراجعة؛ المعتمدة لا تُعدَّل (حتى مباشرة في قاعدة البيانات)", async () => {
    const { branch, manager, accountant, category } = await setup();
    const { invoice } = await createPurchase(prisma, manager, input(branch.id, category.id), file());
    await rejectPurchase(prisma, accountant, invoice.id, "المبلغ لا يطابق الصورة");
    const u = await updatePurchase(prisma, manager, invoice.id, { ...input(branch.id, category.id), totalAmount: "230", vatAmount: "30" });
    expect(u!.status).toBe("PENDING_REVIEW");
    expect(u!.rejectionReason).toBeNull();
    expect(u!.netAmount.toFixed(2)).toBe("200.00");
    await approvePurchase(prisma, accountant, invoice.id);
    await expect(updatePurchase(prisma, manager, invoice.id, input(branch.id, category.id))).rejects.toThrow(/المعتمدة لا تُعدَّل/);
    await expect(prisma.$executeRaw`UPDATE purchase_invoices SET total_amount = 1, vat_amount = 0, net_amount = 1 WHERE id = ${invoice.id}::uuid`).rejects.toThrow(/ZAKI_IMMUTABLE/);
    await expect(prisma.$executeRaw`DELETE FROM purchase_invoices WHERE id = ${invoice.id}::uuid`).rejects.toThrow(/ZAKI_IMMUTABLE/);
    const doc = await prisma.document.findFirstOrThrow({ where: { purchaseInvoiceId: invoice.id } });
    await expect(deleteDocument(prisma, manager, doc.id)).rejects.toThrow(/معتمدة/);
  });

  it("الدفع للمورد: بعد الاعتماد فقط، مع الوسيلة والتاريخ، ويمكن إلغاؤه بسبب", async () => {
    const { branch, manager, accountant, category } = await setup();
    const { invoice } = await createPurchase(prisma, manager, input(branch.id, category.id), file());
    await expect(markPurchasePaid(prisma, accountant, invoice.id, { method: "BANK_TRANSFER", paidOn: TODAY })).rejects.toThrow(/اعتمد الفاتورة أولًا/);
    await expect(prisma.$executeRaw`UPDATE purchase_invoices SET payment_status = 'PAID', payment_method = 'CASH', paid_on = CURRENT_DATE WHERE id = ${invoice.id}::uuid`).rejects.toThrow(/purchase_payment_complete/);
    await approvePurchase(prisma, accountant, invoice.id);
    await expect(markPurchasePaid(prisma, manager, invoice.id, { method: "CASH", paidOn: TODAY })).rejects.toThrow();
    const paid = await markPurchasePaid(prisma, accountant, invoice.id, { method: "BANK_TRANSFER", paidOn: TODAY });
    expect(paid.paymentStatus).toBe("PAID");
    await expect(markPurchaseUnpaid(prisma, accountant, invoice.id, "x")).rejects.toThrow(/سبب/);
    const unpaid = await markPurchaseUnpaid(prisma, accountant, invoice.id, "سُجلت بالخطأ");
    expect(unpaid.paymentStatus).toBe("UNPAID");
    expect(unpaid.paidOn).toBeNull();
  });

  it("القائمة: نطاق الفرع والمجاميع (المعتمد، بانتظار المراجعة، غير المدفوع)", async () => {
    const { branch, manager, accountant, category } = await setup();
    const a = await createPurchase(prisma, manager, input(branch.id, category.id, { totalAmount: "115", vatAmount: "15" }), file());
    await createPurchase(prisma, manager, input(branch.id, category.id, { totalAmount: "230", vatAmount: "30" }), file());
    await approvePurchase(prisma, accountant, a.invoice.id);
    const r = await listPurchases(prisma, manager, { branchId: branch.id });
    expect(r.total).toBe(2);
    expect(r.sums.approvedTotal.toFixed(2)).toBe("115.00");
    expect(r.sums.approvedVat.toFixed(2)).toBe("15.00");
    expect(r.sums.pendingTotal.toFixed(2)).toBe("230.00");
    expect(r.sums.unpaidTotal.toFixed(2)).toBe("115.00");
    const { actor: stranger } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    expect((await listPurchases(prisma, stranger, {})).invoices.some((p) => p.branchId === branch.id)).toBe(false);
  });

  it("التصنيفات: المحاسب يضيف ويوقف، والموقوف لا يُستخدم في فاتورة جديدة", async () => {
    const { branch, manager, accountant } = await setup();
    const name = `تصنيف ${randomUUID().slice(0, 6)}`;
    const c = await createCategory(prisma, accountant, name);
    await expect(createCategory(prisma, accountant, name)).rejects.toThrow(/نفس الاسم/);
    await expect(createCategory(prisma, manager, "تصنيف المدير")).rejects.toThrow();
    await setCategoryActive(prisma, accountant, c.id, false);
    await expect(createPurchase(prisma, manager, input(branch.id, c.id), file())).rejects.toThrow(/التصنيف غير متاح/);
  });
});
