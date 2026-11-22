require('ts-node/register/transpile-only');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const nodemailer = require('nodemailer');
const { OwnerNotificationsService } = require('../src/customer-portal/owner-notifications.service');

test('owner receives registration and subscription details through SMTP', async (t) => {
  const emails = [];
  const config = {
    SMTP_HOST: 'smtp.example.com', SMTP_USER: 'sender', SMTP_PASSWORD: 'secret',
    SMTP_FROM: 'sender@example.com',
  };
  t.mock.method(nodemailer, 'createTransport', (options) => {
    assert.equal(options.requireTLS, true);
    return { sendMail: async (email) => emails.push(email), close() {} };
  });
  const customer = { id: 7, name: 'Customer Name', email: 'customer@example.com', phone: '1234', passwordHash: 'private-hash' };
  const service = new OwnerNotificationsService({ get: (key, fallback) => config[key] ?? fallback }, {
    customer: { findUniqueOrThrow: async () => customer },
  });
  await service.registration(customer, 'Growth');
  await service.subscription({ id: 9, customerId: 7, amount: 350000, currency: 'EGP' }, 'Growth', 'YEARLY');

  assert.equal(emails.length, 2);
  assert.equal(emails[0].to, 'elagwza34@gmail.com');
  assert.match(emails[0].text, /Customer Name.*[\s\S]*customer@example.com[\s\S]*1234[\s\S]*Growth/);
  assert.doesNotMatch(emails[0].text, /private-hash/);
  assert.equal(emails[1].to, emails[0].to);
  assert.match(emails[1].text, /Customer Name[\s\S]*Growth[\s\S]*3500\.00 EGP[\s\S]*https:\/\/licenses\.awexen\.com\/payments/);
});
