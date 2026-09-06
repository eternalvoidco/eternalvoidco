// ─────────────────────────────────────────────────────────────────────────────
// Order confirmation email.
//
// Reuses the provider already in this project (Resend, called over fetch — see
// api/preorder.js) rather than introducing a second one. If RESEND_API_KEY is
// absent this is a no-op that says so in the logs: an order that cannot be
// emailed is still a valid, recorded, paid order.
//
// The email is a receipt, never the record. The database remains authoritative.
// ─────────────────────────────────────────────────────────────────────────────

const FROM = 'VOID© <support@eternalvoid.co>';

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function money(amount, currency) {
    const symbol = String(currency).toLowerCase() === 'eur' ? '€' : '';
    return `${symbol}${(Number(amount) / 100).toFixed(2)}`;
}

function itemRows(items, currency) {
    return items.map((item) => `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #1a1a1a;color:#f2efe9;font-size:14px;">
            ${escapeHtml(item.product_name)}
            <span style="color:#8a8580;"> &middot; ${escapeHtml(item.size)} &middot; ${escapeHtml(item.quantity)}</span>
          </td>
          <td align="right" style="padding:14px 0;border-bottom:1px solid #1a1a1a;color:#f2efe9;font-size:14px;white-space:nowrap;">
            ${money(item.unit_amount * item.quantity, currency)}
          </td>
        </tr>`).join('');
}

function totalRow(label, amount, currency, strong) {
    const colour = strong ? '#c7a96c' : '#8a8580';
    const weight = strong ? '600' : '400';
    return `
        <tr>
          <td style="padding:6px 0;color:${colour};font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:${weight};">${escapeHtml(label)}</td>
          <td align="right" style="padding:6px 0;color:${strong ? '#f2efe9' : '#8a8580'};font-size:${strong ? '16px' : '13px'};font-weight:${weight};white-space:nowrap;">${money(amount, currency)}</td>
        </tr>`;
}

function addressBlock(address) {
    if (!address) return '';
    const lines = [
        `${address.firstName || ''} ${address.lastName || ''}`.trim(),
        address.line1,
        address.line2,
        `${address.postalCode || ''} ${address.city || ''}`.trim(),
        address.country
    ].filter(Boolean);
    return lines.map((line) => escapeHtml(line)).join('<br>');
}

export async function sendOrderConfirmation(order, items) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        console.warn('_email: RESEND_API_KEY not set — confirmation for', order.order_number, 'not sent');
        return { sent: false, reason: 'not_configured' };
    }

    const currency = order.currency || 'eur';
    const html = `<!DOCTYPE html>
<html lang="en" style="margin:0;padding:0;background-color:#000000;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Order ${escapeHtml(order.order_number)}</title>
</head>
<body style="margin:0;padding:0;background-color:#000000;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#000000;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
        <tr><td style="padding-bottom:34px;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:0.34em;color:#f2efe9;">VOID<sup style="font-size:10px;">&copy;</sup></div>
        </td></tr>

        <tr><td style="padding-bottom:8px;">
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.34em;text-transform:uppercase;color:#c7a96c;">Acquisition Confirmed</div>
        </td></tr>
        <tr><td style="padding-bottom:28px;">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#f2efe9;">${escapeHtml(order.order_number)}</div>
        </td></tr>

        <tr><td style="padding-bottom:28px;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.8;color:#8a8580;">
            ${escapeHtml(order.customer_first_name)}, your selection has entered preparation.
            You will hear from us again when it leaves the atelier.
          </p>
        </td></tr>

        <tr><td style="padding-bottom:10px;">
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#c7a96c;">Your Selection</div>
        </td></tr>
        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Helvetica,Arial,sans-serif;border-top:1px solid #1a1a1a;">
            ${itemRows(items, currency)}
          </table>
        </td></tr>

        <tr><td style="padding-top:18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Helvetica,Arial,sans-serif;">
            ${totalRow('Subtotal', order.subtotal_amount, currency, false)}
            ${totalRow('Delivery', order.shipping_amount, currency, false)}
            ${Number(order.tax_amount) > 0 ? totalRow('Tax', order.tax_amount, currency, false) : ''}
            ${totalRow('Total', order.total_amount, currency, true)}
          </table>
        </td></tr>

        <tr><td style="padding-top:34px;padding-bottom:10px;">
          <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:#c7a96c;">Delivery</div>
        </td></tr>
        <tr><td style="padding-bottom:34px;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.9;color:#8a8580;">
            ${addressBlock(order.shipping_address)}
          </p>
        </td></tr>

        <tr><td style="border-top:1px solid #1a1a1a;padding-top:22px;">
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.9;color:#6d6963;">
            Questions about this order? Reply to this message or write to
            <a href="mailto:support@eternalvoid.co" style="color:#c7a96c;text-decoration:none;">support@eternalvoid.co</a>,
            quoting ${escapeHtml(order.order_number)}.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: FROM,
            to: order.customer_email,
            subject: `${order.order_number} · Acquisition confirmed`,
            html
        })
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`resend_failed_${res.status}: ${detail.slice(0, 200)}`);
    }
    return { sent: true };
}
