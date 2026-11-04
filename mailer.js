// إرسال ملخص الاجتماع بالإيميل (SMTP — مثلاً إيميل من cPanel زي meet@startupsmart.net)
const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST;
const enabled = !!(host && process.env.SMTP_USER && process.env.SMTP_PASS);
const port = Number(process.env.SMTP_PORT) || 465;
const from = process.env.SMTP_FROM || (process.env.SMTP_USER ? `"smart Meet | ذكي" <${process.env.SMTP_USER}>` : '');

const transport = enabled
  ? nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  : null;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// تحويل الملخص (عناوين ## ونقاط -) لـ HTML بسيط
function summaryHtml(text, dir) {
  const out = [];
  let inList = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3 style="margin:22px 0 8px;font-size:16px;color:#132e4d;border-${dir === 'rtl' ? 'right' : 'left'}:4px solid #1faec1;padding-${dir === 'rtl' ? 'right' : 'left'}:10px">${esc(line.slice(3))}</h3>`);
    } else if (/^[-•]\s+/.test(line)) {
      if (!inList) { out.push(`<ul style="margin:0;padding-${dir === 'rtl' ? 'right' : 'left'}:20px">`); inList = true; }
      out.push(`<li style="margin:4px 0;line-height:1.7">${esc(line.replace(/^[-•]\s+/, ''))}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p style="margin:6px 0;line-height:1.8">${esc(line)}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function buildEmail({ title, startedAt, minutes, attendees, summary, lang, link }) {
  const ar = lang === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const date = new Date(startedAt).toLocaleString(ar ? 'ar-EG' : 'en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Riyadh' });
  const t = ar
    ? { subject: `ملخص اجتماع: ${title}`, hello: 'ملخص الاجتماع', when: 'الموعد', dur: 'المدة', min: 'دقيقة', who: 'الحضور', note: 'الملخص ده اتعمل تلقائيًا بالذكاء الاصطناعي من محادثة الاجتماع والكلام المكتوب، فراجعه قبل الاعتماد عليه.', open: 'فتح نظام الاجتماعات' }
    : { subject: `Meeting summary: ${title}`, hello: 'Meeting summary', when: 'When', dur: 'Duration', min: 'min', who: 'Attendees', note: 'This summary was generated automatically by AI from the meeting chat and captions. Please review it before relying on it.', open: 'Open smart Meet' };
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><body style="margin:0;background:#f4f8fb;font-family:Tahoma,Arial,sans-serif;color:#132e4d">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px">
    <div style="background:linear-gradient(135deg,#132e4d,#1d4471);border-radius:18px 18px 0 0;padding:22px 24px;color:#fff">
      <div style="font-size:13px;letter-spacing:.08em;color:#4fd1e0;direction:ltr;text-align:${ar ? 'right' : 'left'}">smart Meet · ذكي</div>
      <div style="font-size:22px;font-weight:bold;margin-top:6px">${esc(t.hello)}: ${esc(title)}</div>
    </div>
    <div style="background:#fff;border-radius:0 0 18px 18px;padding:20px 24px;border:1px solid #e2eaf2;border-top:0">
      <table style="width:100%;font-size:14px;color:#5d7089;margin-bottom:6px" dir="${dir}">
        <tr><td style="padding:3px 0;width:90px">${t.when}</td><td style="color:#132e4d">${esc(date)}</td></tr>
        <tr><td style="padding:3px 0">${t.dur}</td><td style="color:#132e4d">${minutes} ${t.min}</td></tr>
        <tr><td style="padding:3px 0;vertical-align:top">${t.who}</td><td style="color:#132e4d">${esc(attendees)}</td></tr>
      </table>
      ${summaryHtml(summary, dir)}
      <p style="margin:24px 0 0;font-size:12px;color:#8ea3bd;line-height:1.7">${t.note}</p>
      ${link ? `<p style="margin:16px 0 0"><a href="${esc(link)}" style="background:#1faec1;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;display:inline-block">${t.open}</a></p>` : ''}
    </div>
    <p style="text-align:center;font-size:12px;color:#8ea3bd;margin-top:14px">ذكي smart لحاضنات ومسرعات الأعمال</p>
  </div></body></html>`;
  const text = `${t.hello}: ${title}\n${t.when}: ${date}\n${t.dur}: ${minutes} ${t.min}\n${t.who}: ${attendees}\n\n${summary.replace(/^## /gm, '')}\n\n${t.note}`;
  return { subject: t.subject, html, text };
}

async function sendSummary(to, data) {
  if (!transport) return false;
  const mail = buildEmail(data);
  await transport.sendMail({ from, to, subject: mail.subject, html: mail.html, text: mail.text });
  return true;
}

module.exports = { enabled, sendSummary, buildEmail };
