const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// In-memory / file log of sent emails for local testing and inspection
const SENT_EMAILS_LOG_PATH = path.join(__dirname, 'data', 'sent_emails.json');

let transporter = null;
let isDevTransport = false;

/**
 * Initialize or get Nodemailer Transporter
 */
function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;

  if (host && user && pass) {
    // Production / Configured SMTP
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
    isDevTransport = false;
    console.log(`[Email] Configured with live SMTP server: ${host}:${port}`);
  } else {
    // Fallback: Local Stream / Mock Transport for seamless development and testing
    transporter = nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true
    });
    isDevTransport = true;
    console.log('[Email] Operating in Development Simulation Mode (Emails logged to backend/data/sent_emails.json)');
  }

  return transporter;
}

/**
 * Log outgoing email for verification
 */
function recordSentEmail(emailRecord) {
  try {
    const dir = path.dirname(SENT_EMAILS_LOG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let records = [];
    if (fs.existsSync(SENT_EMAILS_LOG_PATH)) {
      try {
        records = JSON.parse(fs.readFileSync(SENT_EMAILS_LOG_PATH, 'utf-8'));
      } catch (e) {
        records = [];
      }
    }

    records.unshift({
      id: 'mail_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      ...emailRecord
    });

    // Keep last 100 emails
    if (records.length > 100) records = records.slice(0, 100);

    fs.writeFileSync(SENT_EMAILS_LOG_PATH, JSON.stringify(records, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Email] Error recording sent email to log:', err);
  }
}

/**
 * Get recent sent emails log
 */
function getSentEmailsLog(limit = 20) {
  try {
    if (fs.existsSync(SENT_EMAILS_LOG_PATH)) {
      const records = JSON.parse(fs.readFileSync(SENT_EMAILS_LOG_PATH, 'utf-8'));
      return records.slice(0, limit);
    }
  } catch (e) {}
  return [];
}

/**
 * Base email layout wrapper
 */
function wrapHtmlEmail({ title, subtitle, contentHtml, footerNote }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }
    .email-wrapper { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); }
    .email-header { background: linear-gradient(135deg, #4c1d95, #6d28d9, #7c3aed); color: #ffffff; padding: 28px 24px; text-align: center; }
    .email-header h1 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em; }
    .email-header p { margin: 6px 0 0 0; font-size: 13px; color: #ddd6fe; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
    .email-body { padding: 32px 28px; line-height: 1.6; font-size: 15px; }
    .pass-card { background: #f8fafc; border: 2px dashed #c4b5fd; border-radius: 14px; padding: 24px; text-align: center; margin: 24px 0; }
    .pass-id { font-size: 22px; font-weight: 800; color: #5b21b6; font-family: monospace; letter-spacing: 0.05em; margin-bottom: 8px; }
    .qr-container { background: #ffffff; padding: 16px; border-radius: 12px; display: inline-block; box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin: 16px 0; border: 1px solid #e2e8f0; }
    .qr-container img { display: block; max-width: 220px; height: auto; margin: 0 auto; }
    .detail-table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; text-align: left; }
    .detail-table td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; }
    .detail-label { color: #64748b; font-weight: 600; width: 38%; }
    .detail-value { color: #0f172a; font-weight: 700; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; }
    .badge-success { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
    .badge-danger { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
    .email-footer { background: #f1f5f9; padding: 20px 24px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
    .btn { display: inline-block; background: #6d28d9; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 700; font-size: 14px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="email-header">
      <div style="font-size: 28px; margin-bottom: 6px;">🎓</div>
      <h1>EventHub</h1>
      <p>Kumaraguru College of Technology, Coimbatore</p>
    </div>
    <div class="email-body">
      <h2 style="margin-top: 0; color: #1e1b4b; font-size: 18px;">${subtitle || title}</h2>
      ${contentHtml}
    </div>
    <div class="email-footer">
      <p style="margin: 0 0 6px 0;"><strong>Official Digital Attendance Management System</strong></p>
      <p style="margin: 0 0 6px 0;">Kumaraguru College of Technology &bull; Athipalayam Road, Chinnavedampatti, Coimbatore, TN 641049</p>
      <p style="margin: 0; color: #94a3b8;">${footerNote || 'This is an automated communication generated by KCT EventHub.'}</p>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * 1. Send Digital Event Registration Pass with Embedded QR Code
 */
async function sendPassEmail({ to, studentName, rollNumber, event, registrationId, qrCodeDataUrl }) {
  try {
    const t = getTransporter();
    const fromAddress = process.env.SMTP_FROM || '"KCT EventHub" <no-reply@kct.ac.in>';
    const eventName = event.name || 'Campus Event';

    const attachments = [];
    let qrImgSrc = qrCodeDataUrl;

    // Convert data URL to inline CID attachment if it is base64
    if (qrCodeDataUrl && qrCodeDataUrl.startsWith('data:image/')) {
      const base64Data = qrCodeDataUrl.split(',')[1];
      attachments.push({
        filename: `pass-${registrationId}.png`,
        content: Buffer.from(base64Data, 'base64'),
        cid: 'eventhub_pass_qr'
      });
      qrImgSrc = 'cid:eventhub_pass_qr';
    }

    const contentHtml = `
      <p>Dear <strong>${studentName}</strong>,</p>
      <p>Your registration for <strong>${eventName}</strong> has been officially confirmed! Your verified entry pass with your College Roll Number snapshot is ready below:</p>

      <div class="pass-card">
        <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 4px;">Verified Attendance Pass</div>
        <div class="pass-id">${registrationId}</div>
        <div style="font-size: 14px; font-weight: 700; color: #1e1b4b;">College Roll No: <span style="color: #6d28d9;">${rollNumber}</span></div>
        
        <div class="qr-container">
          <img src="${qrImgSrc}" alt="Digital Entry Pass QR Code" />
        </div>
        
        <p style="font-size: 12px; color: #64748b; margin: 4px 0 0 0;">
          📲 Present this official QR code at the entrance scanner on event day for rapid check-in.
        </p>
      </div>

      <table class="detail-table">
        <tr>
          <td class="detail-label">Event Name:</td>
          <td class="detail-value">${eventName}</td>
        </tr>
        <tr>
          <td class="detail-label">Category:</td>
          <td class="detail-value">${event.category || 'Technical'}</td>
        </tr>
        <tr>
          <td class="detail-label">Date &amp; Time:</td>
          <td class="detail-value">${event.date || 'Campus Schedule'} &bull; ${event.time || '09:30 AM'}</td>
        </tr>
        <tr>
          <td class="detail-label">Campus Venue:</td>
          <td class="detail-value">${event.venue || 'KCT Campus'}</td>
        </tr>
        <tr>
          <td class="detail-label">Registration ID:</td>
          <td class="detail-value" style="font-family: monospace;">${registrationId}</td>
        </tr>
      </table>

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; margin: 20px 0; font-size: 13px; color: #166534;">
        <strong>Campus Entry Guidelines:</strong>
        <ul style="margin: 6px 0 0 0; padding-left: 20px;">
          <li>Bring your physical KCT Student ID card along with this digital pass.</li>
          <li>Each QR pass is single-use and tied strictly to Roll Number <strong>${rollNumber}</strong>.</li>
          <li>Duplicate scans will be flagged by the security scanner.</li>
        </ul>
      </div>

      <p style="font-size: 13px; color: #64748b;">
        You can also access your live pass anytime on the student portal at: <a href="http://localhost:5000/my-registration.html" style="color: #6d28d9; font-weight: 600;">http://localhost:5000/my-registration.html</a>.
      </p>
    `;

    const html = wrapHtmlEmail({
      title: `Event Pass: ${eventName}`,
      subtitle: `Registration Confirmed: ${eventName}`,
      contentHtml
    });

    const mailOptions = {
      from: fromAddress,
      to,
      subject: `🎓 EventHub Registration Pass: ${eventName} (${registrationId})`,
      html,
      attachments
    };

    const info = await t.sendMail(mailOptions);

    recordSentEmail({
      type: 'PASS_DELIVERY',
      recipient: to,
      subject: mailOptions.subject,
      studentName,
      rollNumber,
      eventId: event.id,
      eventName,
      registrationId,
      preview: isDevTransport ? 'Simulation Mode' : 'Sent via SMTP'
    });

    console.log(`[Email] Pass delivered successfully to ${to} for registration ${registrationId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email] Failed to send pass delivery email:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 2. Send Notification When Student Event Proposal is Approved
 */
async function sendProposalApprovedEmail({ to, creatorName, eventName, approvedByName, eventId }) {
  try {
    const t = getTransporter();
    const fromAddress = process.env.SMTP_FROM || '"KCT EventHub" <no-reply@kct.ac.in>';

    const contentHtml = `
      <p>Dear <strong>${creatorName || 'Student Organizer'}</strong>,</p>
      <p>Great news! Your campus event proposal for <strong>"${eventName}"</strong> has been reviewed and officially <span class="badge badge-success">Approved</span>!</p>

      <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 20px; margin: 20px 0;">
        <div style="color: #166534; font-weight: 700; font-size: 16px; margin-bottom: 6px;">
          🎉 Event is Now Published &amp; Live
        </div>
        <p style="margin: 0; font-size: 14px; color: #15803d;">
          Your event has been activated on the public KCT Events Catalog. Students across the college can now view event details and register for digital passes.
        </p>
        <p style="margin: 10px 0 0 0; font-size: 13px; color: #166534;">
          <strong>Evaluated By:</strong> ${approvedByName || 'Authorized Faculty Organizer'}
        </p>
      </div>

      <div style="text-align: center; margin: 24px 0;">
        <a href="http://localhost:5000/events.html" class="btn">View in Campus Catalog &rarr;</a>
      </div>
    `;

    const html = wrapHtmlEmail({
      title: `Event Proposal Approved: ${eventName}`,
      subtitle: `Proposal Approved: ${eventName}`,
      contentHtml
    });

    const mailOptions = {
      from: fromAddress,
      to,
      subject: `✅ Event Proposal Approved: "${eventName}" - KCT EventHub`,
      html
    };

    const info = await t.sendMail(mailOptions);

    recordSentEmail({
      type: 'PROPOSAL_APPROVED',
      recipient: to,
      subject: mailOptions.subject,
      creatorName,
      eventName,
      eventId
    });

    console.log(`[Email] Proposal approval notification sent to ${to} for event ${eventName}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email] Failed to send proposal approval email:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 3. Send Notification When Student Event Proposal is Declined (With Mandatory Justification)
 */
async function sendProposalDeclinedEmail({ to, creatorName, eventName, declinedByName, rejectionReason, eventId }) {
  try {
    const t = getTransporter();
    const fromAddress = process.env.SMTP_FROM || '"KCT EventHub" <no-reply@kct.ac.in>';

    const contentHtml = `
      <p>Dear <strong>${creatorName || 'Student Organizer'}</strong>,</p>
      <p>We are writing to update you on your event proposal for <strong>"${eventName}"</strong>.</p>
      
      <p>After careful evaluation by the college administration, your proposal could not be approved in its current form and has been <span class="badge badge-danger">Declined</span>.</p>

      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px; margin: 20px 0;">
        <div style="color: #991b1b; font-weight: 700; font-size: 14px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;">
          Mandatory Evaluator Justification &amp; Feedback:
        </div>
        <blockquote style="margin: 0; padding: 12px 16px; background: #ffffff; border-left: 4px solid #ef4444; border-radius: 6px; font-style: italic; color: #7f1d1d; font-size: 14px;">
          "${rejectionReason || 'No specific reason provided.'}"
        </blockquote>
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #991b1b;">
          <strong>Evaluated By:</strong> ${declinedByName || 'Faculty Coordinator / Administration'}
        </p>
      </div>

      <p style="font-size: 14px; color: #475569;">
        <strong>Next Steps:</strong> You may address the feedback above (such as adjusting the proposed schedule, venue capacity, or departmental coordination) and submit a revised proposal through your student dashboard.
      </p>

      <div style="text-align: center; margin: 24px 0;">
        <a href="http://localhost:5000/student-dashboard.html" class="btn">Go to Student Dashboard &rarr;</a>
      </div>
    `;

    const html = wrapHtmlEmail({
      title: `Event Proposal Update: ${eventName}`,
      subtitle: `Proposal Status Update: ${eventName}`,
      contentHtml
    });

    const mailOptions = {
      from: fromAddress,
      to,
      subject: `⚠️ Event Proposal Update: "${eventName}" - KCT EventHub`,
      html
    };

    const info = await t.sendMail(mailOptions);

    recordSentEmail({
      type: 'PROPOSAL_DECLINED',
      recipient: to,
      subject: mailOptions.subject,
      creatorName,
      eventName,
      rejectionReason,
      eventId
    });

    console.log(`[Email] Proposal decline notification sent to ${to} for event ${eventName}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email] Failed to send proposal decline email:', err);
    return { success: false, error: err.message };
  }
}

/**
 * 4. Send Attendance Confirmation Notification (Triggered on QR Scan)
 */
async function sendAttendanceConfirmedEmail({ to, studentName, eventName, checkInTime, rollNumber }) {
  try {
    const t = getTransporter();
    const fromAddress = process.env.SMTP_FROM || '"KCT EventHub" <no-reply@kct.ac.in>';
    const formattedTime = new Date(checkInTime || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const contentHtml = `
      <p>Dear <strong>${studentName}</strong>,</p>
      <p>Your physical attendance for <strong>${eventName}</strong> has been successfully recorded and verified at the entrance checkpoint!</p>

      <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
        <div style="font-size: 32px; margin-bottom: 6px;">🎉</div>
        <div style="font-size: 18px; font-weight: 800; color: #166534;">Attendance Marked Successfully</div>
        <div style="font-size: 14px; font-weight: 600; color: #15803d; margin-top: 4px;">
          College Roll No: <strong>${rollNumber}</strong>
        </div>
        <div style="font-size: 13px; color: #166534; margin-top: 6px;">
          Verified Check-in Time: <strong>${formattedTime}</strong>
        </div>
      </div>

      <p style="font-size: 13px; color: #64748b;">
        This record has been immutably logged into the official KCT campus attendance ledger. Enjoy the event!
      </p>
    `;

    const html = wrapHtmlEmail({
      title: `Attendance Confirmed: ${eventName}`,
      subtitle: `Verified Attendance Recorded`,
      contentHtml
    });

    const mailOptions = {
      from: fromAddress,
      to,
      subject: `🎉 Attendance Confirmed: ${eventName} (${rollNumber})`,
      html
    };

    const info = await t.sendMail(mailOptions);

    recordSentEmail({
      type: 'ATTENDANCE_CONFIRMED',
      recipient: to,
      subject: mailOptions.subject,
      studentName,
      rollNumber,
      eventName
    });

    console.log(`[Email] Attendance confirmation sent to ${to} for event ${eventName}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email] Failed to send attendance confirmation email:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  getTransporter,
  getSentEmailsLog,
  sendPassEmail,
  sendProposalApprovedEmail,
  sendProposalDeclinedEmail,
  sendAttendanceConfirmedEmail
};
