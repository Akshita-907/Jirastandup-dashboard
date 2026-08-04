#!/usr/bin/env node
/**
 * send-checkin.js — CLI to post the EOD check-in to the Google Chat AI space.
 * Run unattended at your EOD time (e.g. 18:00) via Windows Task Scheduler:
 *
 *   node scripts/send-checkin.js
 *
 * Needs GCHAT_WEBHOOK_URL in .env (Space → Manage webhooks → copy URL).
 * Add --preview to print the messages without sending.
 */
import { sendCheckin } from './checkin-core.js';

const dryRun = process.argv.includes('--preview');
sendCheckin({ dryRun }).then((r) => {
  if (r.ok) {
    console.log(`✔ Sent ${r.sent} check-in message(s) for ${r.date}.`);
  } else if (r.reason === 'no-deadline-items') {
    console.log(`• No deadline commitments in the ${r.date || 'latest'} notes — nothing to send.`);
  } else if (r.reason === 'no-webhook') {
    console.log('⚠ GCHAT_WEBHOOK_URL not set — preview only, nothing sent:\n');
    r.messages.forEach((m) => console.log(m.text + '\n'));
  } else if (r.reason === 'dry-run') {
    r.messages.forEach((m) => console.log(m.text + '\n'));
  }
}).catch((e) => { console.error('✖ Check-in failed:', e.message); process.exit(1); });
