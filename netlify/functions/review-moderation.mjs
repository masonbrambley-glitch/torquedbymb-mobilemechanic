import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const FORM_NAME = "Review Request";
const STORE_NAME = "torquedbymb-reviews";
const TOKEN_LIFETIME_SECONDS = 14 * 24 * 60 * 60;
const MAX_REVIEW_LENGTH = 1200;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function reviewsStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function makeToken(id, action, expires) {
  const payload = Buffer.from(JSON.stringify({ id, action, expires })).toString("base64url");
  const signature = createHmac("sha256", requiredEnv("REVIEW_APPROVAL_SECRET"))
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function readToken(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = createHmac("sha256", requiredEnv("REVIEW_APPROVAL_SECRET"))
    .update(payload)
    .digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!/^[0-9a-f-]{36}$/i.test(data.id)) return null;
    if (!["approve", "reject"].includes(data.action)) return null;
    if (!Number.isInteger(data.expires) || data.expires < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function responseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  };
}

function moderationPage({ action, token, message, alreadyReviewed = false }) {
  const title = action === "approve" ? "Approve this review?" : "Reject this review?";
  const verb = action === "approve" ? "Approve review" : "Reject review";
  const content = alreadyReviewed
    ? `<p>This review has already been reviewed. No further change was made.</p>`
    : `<p>This confirmation will ${action === "approve" ? "publish" : "keep private"} the submitted review.</p>
       <form method="post" action="/.netlify/functions/review-moderation">
         <input type="hidden" name="token" value="${escapeHtml(token)}">
         <button type="submit">${verb}</button>
       </form>`;

  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(message || title)} | TorquedByMB</title><style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#111315;color:#f4f3f0;font:16px Arial,sans-serif}.box{width:min(560px,100%);padding:32px;background:#1b1e20;border:1px solid #34383a}.eyebrow{color:#ff7a1a;font-weight:800;letter-spacing:2px;text-transform:uppercase;font-size:12px}h1{font-size:clamp(30px,7vw,42px);margin:14px 0}p{color:#c7c8c6;line-height:1.65}button{margin-top:12px;border:0;border-radius:3px;background:#ff7a1a;color:#111315;padding:14px 20px;font:inherit;font-weight:800;cursor:pointer}
  </style></head><body><main class="box"><div class="eyebrow">TorquedByMB review moderation</div><h1>${escapeHtml(message || title)}</h1>${content}</main></body></html>`, {
    status: 200,
    headers: responseHeaders("text/html; charset=utf-8"),
  });
}

function publishedReview(review) {
  return {
    displayName: review.displayName,
    rating: review.rating,
    workCompleted: review.workCompleted,
    reviewText: review.reviewText,
    publishedAt: review.publishedAt,
  };
}

async function listPublishedReviews() {
  const store = reviewsStore();
  const { blobs } = await store.list({ prefix: "reviews/" });
  const records = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json" })));
  return records
    .filter((review) => review?.status === "approved")
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, 100)
    .map(publishedReview);
}

async function sendApprovalEmail(review, id) {
  const siteUrl = requiredEnv("SITE_URL").replace(/\/$/, "");
  const expiry = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS;
  const approveUrl = `${siteUrl}/.netlify/functions/review-moderation?token=${encodeURIComponent(makeToken(id, "approve", expiry))}`;
  const rejectUrl = `${siteUrl}/.netlify/functions/review-moderation?token=${encodeURIComponent(makeToken(id, "reject", expiry))}`;
  const stars = `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`;
  const work = review.workCompleted ? `<p><strong>Work completed:</strong> ${escapeHtml(review.workCompleted)}</p>` : "";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: requiredEnv("REVIEW_EMAIL_FROM"),
      to: [requiredEnv("REVIEW_NOTIFICATION_EMAIL")],
      subject: `Review Request: ${review.displayName} (${review.rating}/5)`,
      html: `<div style="font-family:Arial,sans-serif;color:#17191b;max-width:640px"><h1>Review Request</h1><p><strong>${escapeHtml(review.displayName)}</strong> · <span style="color:#c95c00">${stars}</span></p>${work}<blockquote style="border-left:3px solid #ff7a1a;padding:8px 16px;margin:20px 0;white-space:pre-wrap">${escapeHtml(review.reviewText)}</blockquote><p>Choose an action. The link opens a confirmation page; the review is not changed until you confirm there.</p><p><a href="${escapeHtml(approveUrl)}" style="display:inline-block;background:#ff7a1a;color:#111315;padding:13px 18px;text-decoration:none;font-weight:bold;border-radius:3px;margin-right:8px">Approve</a><a href="${escapeHtml(rejectUrl)}" style="display:inline-block;background:#eeeeec;color:#111315;padding:13px 18px;text-decoration:none;font-weight:bold;border-radius:3px">Reject</a></p><p style="font-size:12px;color:#666">These links expire in 14 days and can be used once.</p></div>`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Review email provider returned ${response.status}: ${detail.slice(0, 300)}`);
  }
}

export default {
  async formSubmitted(event) {
    const data = event?.data ?? {};
    if (data["form-name"] !== FORM_NAME) return;
    if (data["bot-field"] || data["publication-consent"] !== "yes") return;

    const displayName = String(data["display-name"] ?? "").trim().slice(0, 80);
    const rating = Number(data.rating);
    const reviewText = String(data["review-text"] ?? "").trim().slice(0, MAX_REVIEW_LENGTH);
    if (!displayName || !Number.isInteger(rating) || rating < 1 || rating > 5 || !reviewText) return;

    const review = {
      displayName,
      rating,
      workCompleted: String(data["work-completed"] ?? "").trim().slice(0, 120),
      reviewText,
      status: "pending",
      submittedAt: new Date().toISOString(),
    };
    const id = randomUUID();
    const store = reviewsStore();
    await store.setJSON(`reviews/${id}`, review);
    await sendApprovalEmail(review, id);
  },

  async fetch(request) {
    const url = new URL(request.url);

    if (url.searchParams.get("public") === "1" && request.method === "GET") {
      return Response.json(await listPublishedReviews(), {
        headers: { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" },
      });
    }

    if (request.method === "GET") {
      const token = url.searchParams.get("token");
      const data = readToken(token);
      if (!data) return moderationPage({ action: "approve", message: "This review link is invalid or has expired." });
      const record = await reviewsStore().get(`reviews/${data.id}`, { type: "json" });
      if (!record) return moderationPage({ action: data.action, message: "This review could not be found." });
      return moderationPage({ action: data.action, token, alreadyReviewed: record.status !== "pending" });
    }

    if (request.method === "POST") {
      const form = await request.formData();
      const token = String(form.get("token") ?? "");
      const data = readToken(token);
      if (!data) return moderationPage({ action: "approve", message: "This review link is invalid or has expired." });
      const store = reviewsStore();
      const key = `reviews/${data.id}`;
      const entry = await store.getWithMetadata(key, { type: "json" });
      const record = entry?.data;
      if (!record) return moderationPage({ action: data.action, message: "This review could not be found." });
      if (record.status !== "pending") return moderationPage({ action: data.action, alreadyReviewed: true });

      const reviewedAt = new Date().toISOString();
      const updated = data.action === "approve"
        ? { ...record, status: "approved", publishedAt: reviewedAt }
        : { ...record, status: "rejected", reviewedAt };
      const { modified } = await store.setJSON(key, updated, { onlyIfMatch: entry.etag });
      if (!modified) return moderationPage({ action: data.action, alreadyReviewed: true });
      if (data.action === "approve") {
        return moderationPage({ action: data.action, message: "Review approved and published." });
      }
      return moderationPage({ action: data.action, message: "Review rejected. It will remain private." });
    }

    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  },
};
