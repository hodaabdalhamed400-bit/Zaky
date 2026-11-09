import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, makeActor, branchByCode } from "./helpers";
import { addContact, addInteraction, createTenant, getTenant, listTenants, setTenantArchived, updateTenant } from "@/services/tenants.service";
import { deleteDocument, listDocuments, readDocument, sniffMime, uploadDocument } from "@/services/documents.service";

const tenDigits = () => String(1000000000 + Math.floor(Math.random() * 8999999999)).slice(0, 10);
const mobile = () => `05${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const PDF = new TextEncoder().encode("%PDF-1.4\n%test\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");

async function tenantInput(branchCode: string, over: Record<string, unknown> = {}) {
  return { type: "COMPANY", name: `شركة ${randomUUID().slice(0, 6)}`, mobile: mobile(), primaryBranchId: (await branchByCode(branchCode)).id, ...over };
}

describe("المستأجرون", () => {
  it("إنشاء مستأجر وتسجيل من أضافه ومن عدّله", async () => {
    const { actor } = await makeActor("SALES_EMPLOYEE", { branchCodes: ["IZD"] });
    const t = await createTenant(prisma, actor, await tenantInput("IZD", { crNumber: tenDigits(), vatNumber: "300000000000003" }));
    expect(t.createdById).toBe(actor.id);
    const { actor: bm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    const u = await updateTenant(prisma, bm, t.id, await tenantInput("IZD", { name: "اسم معدل", mobile: t.mobile }));
    expect(u.updatedById).toBe(bm.id);
    expect(await prisma.auditLog.count({ where: { entityId: t.id, action: { in: ["tenant.create", "tenant.update"] } } })).toBe(2);
  });

  it("يمنع التكرار: السجل التجاري قطعيًا، والجوال بتحذير يتطلب تأكيدًا", async () => {
    const { actor } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    const cr = tenDigits();
    const a = await createTenant(prisma, actor, await tenantInput("IZD", { crNumber: cr }));
    await expect(createTenant(prisma, actor, await tenantInput("IZD", { crNumber: cr }))).rejects.toThrow(/السجل التجاري مسجل/);
    await expect(createTenant(prisma, actor, await tenantInput("IZD", { mobile: a.mobile }))).rejects.toThrow(/يوجد عميل بنفس الجوال/);
    await expect(createTenant(prisma, actor, await tenantInput("IZD", { mobile: a.mobile, confirmDuplicate: true }))).resolves.toBeTruthy();
    await expect(createTenant(prisma, actor, await tenantInput("IZD", { crNumber: "123" }))).rejects.toThrow(/10 أرقام/);
  });

  it("رقم الهوية لا يُعرض ولا يُبحث به ولا يُعدَّل بدون صلاحية", async () => {
    const { actor: bm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] }); // يملك view_sensitive
    const nid = tenDigits();
    const t = await createTenant(prisma, bm, await tenantInput("IZD", { type: "INDIVIDUAL", nationalId: nid }));
    const { actor: sales } = await makeActor("SALES_EMPLOYEE", { branchCodes: ["IZD"] });
    const seen = await getTenant(prisma, sales, t.id);
    expect(seen.tenant.nationalId).toBeNull();
    expect(seen.tenant.nationalIdHidden).toBe(true);
    expect(JSON.stringify(seen)).not.toContain(nid);
    expect((await listTenants(prisma, sales, { q: nid })).total).toBe(0);
    expect((await listTenants(prisma, bm, { q: nid })).total).toBe(1);
    await expect(createTenant(prisma, sales, await tenantInput("IZD", { nationalId: tenDigits() }))).rejects.toThrow(/رقم الهوية/);
    await updateTenant(prisma, sales, t.id, await tenantInput("IZD", { type: "INDIVIDUAL", name: t.name, mobile: t.mobile, nationalId: null }));
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: t.id } })).nationalId).toBe(nid);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: t.id, action: "tenant.create" } });
    expect(JSON.stringify(audit?.after)).not.toContain(nid);
  });

  it("مدير فرع لا يرى مستأجري فرع آخر", async () => {
    const { actor: a } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    const t = await createTenant(prisma, a, await tenantInput("IZD"));
    const { actor: b } = await makeActor("BRANCH_MANAGER", { branchCodes: ["TBK"] });
    await expect(getTenant(prisma, b, t.id)).rejects.toThrow(/غير موجود/);
    expect((await listTenants(prisma, b, { q: t.name })).total).toBe(0);
    await expect(createTenant(prisma, b, await tenantInput("IZD"))).rejects.toThrow(/الفرع/);
  });

  it("جهات الاتصال وسجل التواصل والأرشفة", async () => {
    const { actor } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    const t = await createTenant(prisma, actor, await tenantInput("IZD"));
    await addContact(prisma, actor, t.id, { name: "أحمد", mobile: mobile(), isPrimary: true });
    await addContact(prisma, actor, t.id, { name: "سارة", isPrimary: true });
    const contacts = await prisma.tenantContact.findMany({ where: { tenantId: t.id } });
    expect(contacts.filter((c) => c.isPrimary).map((c) => c.name)).toEqual(["سارة"]);
    await addInteraction(prisma, actor, t.id, { channel: "CALL", body: "اتصال للاستفسار عن مكتب" });
    expect((await getTenant(prisma, actor, t.id)).tenant.interactions).toHaveLength(1);
    await setTenantArchived(prisma, actor, t.id, true);
    expect((await listTenants(prisma, actor, { q: t.name })).total).toBe(0);
    expect((await listTenants(prisma, actor, { q: t.name, archived: "1" })).total).toBe(1);
  });
});

describe("المستندات", () => {
  it("يتحقق من نوع الملف من محتواه", () => {
    expect(sniffMime(PDF)).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("الرفع والتنزيل مع التحقق من السلامة، ورفض الأنواع غير المسموحة", async () => {
    const { actor } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    const t = await createTenant(prisma, actor, await tenantInput("IZD"));
    const d = await uploadDocument(prisma, actor, { file: { name: "../../etc/passwd سجل.pdf", size: PDF.length, bytes: PDF }, category: "COMMERCIAL_REGISTER", owner: { tenantId: t.id } });
    expect(d.fileName).toBe("etcpasswd سجل.pdf");
    expect(d.storageKey).not.toContain("passwd");
    const r = await readDocument(prisma, actor, d.id);
    expect(Buffer.compare(r.data, Buffer.from(PDF))).toBe(0);
    const html = new TextEncoder().encode("<html>x</html>");
    await expect(uploadDocument(prisma, actor, { file: { name: "a.pdf", size: html.length, bytes: html }, category: "OTHER", owner: { tenantId: t.id } })).rejects.toThrow(/نوع الملف/);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF);
    await expect(uploadDocument(prisma, actor, { file: { name: "b.pdf", size: big.length, bytes: big }, category: "OTHER", owner: { tenantId: t.id } })).rejects.toThrow(/10 ميجابايت/);
  });

  it("عدم كشف مستندات المستأجرين: الحساسة محجوبة، ولا وصول من فرع آخر", async () => {
    const { actor: bm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    const t = await createTenant(prisma, bm, await tenantInput("IZD"));
    const id = await uploadDocument(prisma, bm, { file: { name: "هوية.pdf", size: PDF.length, bytes: PDF }, category: "ID_DOCUMENT", owner: { tenantId: t.id } });
    expect(id.isSensitive).toBe(true);
    const normal = await uploadDocument(prisma, bm, { file: { name: "سجل.pdf", size: PDF.length, bytes: PDF }, category: "COMMERCIAL_REGISTER", owner: { tenantId: t.id } });

    const { actor: sales } = await makeActor("SALES_EMPLOYEE", { branchCodes: ["IZD"] });
    const list = await listDocuments(prisma, sales, { tenantId: t.id });
    expect(list.documents.map((d) => d.id)).toEqual([normal.id]);
    expect(list.hiddenSensitive).toBe(1);
    await expect(readDocument(prisma, sales, id.id)).rejects.toThrow(/غير موجود/);
    await expect(uploadDocument(prisma, sales, { file: { name: "x.pdf", size: PDF.length, bytes: PDF }, category: "ID_DOCUMENT", owner: { tenantId: t.id } })).rejects.toThrow(/حساسة/);

    const { actor: other } = await makeActor("BRANCH_MANAGER", { branchCodes: ["TBK"] });
    await expect(readDocument(prisma, other, normal.id)).rejects.toThrow(/غير موجود/);

    await readDocument(prisma, bm, id.id);
    expect(await prisma.auditLog.count({ where: { action: "document.view_sensitive", entityId: id.id } })).toBe(1);
  });

  it("الحذف منطقي فقط ويُسجَّل", async () => {
    const { actor } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    const t = await createTenant(prisma, actor, await tenantInput("IZD"));
    const d = await uploadDocument(prisma, actor, { file: { name: "a.pdf", size: PDF.length, bytes: PDF }, category: "OTHER", owner: { tenantId: t.id } });
    await deleteDocument(prisma, actor, d.id);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: d.id } })).deletedAt).not.toBeNull();
    await expect(readDocument(prisma, actor, d.id)).rejects.toThrow(/غير موجود/);
    expect(await prisma.auditLog.count({ where: { action: "document.delete", entityId: d.id } })).toBe(1);
  });
});
