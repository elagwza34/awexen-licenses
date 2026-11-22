import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomerMailService {
  private readonly logger = new Logger(CustomerMailService.name);
  private running = false;

  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  link(path: string, planKey?: string) {
    const base = new URL(this.config.get<string>('PORTAL_PUBLIC_URL') || 'https://licenses.awexen.com');
    if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Invalid portal URL');
    const url = new URL(path, base);
    if (planKey) url.searchParams.set('planKey', planKey);
    return url.href;
  }

  async send(email: string, subject: string, text: string) {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASSWORD');
    const from = this.config.get<string>('SMTP_FROM');
    const port = Number(this.config.get('SMTP_PORT', '587'));
    if (!host || !user || !pass || !from || ![465, 587].includes(port)) throw new Error('SMTP is not configured');
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: true, auth: { user, pass },
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 10000, socketTimeout: 15000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    try {
      await transport.sendMail({ from, to: email, subject: `نظام التراخيص — ${subject}`, text });
    } finally {
      transport.close();
    }
  }

  welcome(tx: Prisma.TransactionClient, customer: { id: number; email: string; name: string }) {
    return this.enqueue(tx, `welcome:${customer.id}`, customer.email, 'أهلًا بك', [
      `أهلًا ${customer.name}، تم إنشاء حسابك بنجاح.`,
      `ادخل إلى حسابك لاختيار الباقة المناسبة: ${this.link('/portal/subscription')}`,
    ]);
  }

  async payment(
    tx: Prisma.TransactionClient,
    payment: { id: number; customerId: number; amount: number; currency: string },
    plan: { key: string; name: string; nameAr: string | null },
    interval: string,
    approved: boolean,
  ) {
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: payment.customerId }, select: { name: true, email: true },
    });
    const cycles: Record<string, string> = { MONTHLY: 'شهري', QUARTERLY: 'ربع سنوي', YEARLY: 'سنوي' };
    const cycle = cycles[interval] || interval;
    await this.enqueue(tx, `${approved ? 'approved' : 'pending'}:${payment.id}`, customer.email,
      approved ? 'مبروك، تم تفعيل اشتراكك' : 'تم استلام طلب الدفع', [
        `أهلًا ${customer.name}،`,
        approved ? 'تم تأكيد الدفعة وتفعيل الاشتراك.' : 'استلمنا طلبك، والدفعة بانتظار المراجعة.',
        `الباقة: ${plan.nameAr || plan.name}`,
        `دورة الاشتراك: ${cycle}`,
        `المبلغ: ${(payment.amount / 100).toFixed(2)} ${payment.currency}`,
        `رقم الدفعة: ${payment.id}`,
        approved
          ? `سجّل الدخول لتحميل النظام الخاص بالباقة: ${this.link('/portal/download', plan.key)}`
          : `تابع طلبك من حسابك: ${this.link('/portal/my-subscriptions')}`,
      ]);
  }

  private async enqueue(tx: Prisma.TransactionClient, id: string, email: string, subject: string, lines: string[]) {
    await tx.customerEmail.upsert({
      where: { id }, update: {},
      create: { id, email, subject, body: lines.join('\n') },
    });
  }

  @Interval(10000)
  async deliver() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const jobs = await this.prisma.customerEmail.findMany({
        where: { sentAt: null, availableAt: { lte: now } },
        orderBy: { availableAt: 'asc' }, take: 5,
      });
      for (const job of jobs) {
        const lease = new Date(Date.now() + Math.max(120000, Math.min(3600000, 30000 * 2 ** job.attempts)));
        const claim = await this.prisma.customerEmail.updateMany({
          where: { id: job.id, sentAt: null, availableAt: job.availableAt },
          data: { availableAt: lease, attempts: { increment: 1 } },
        });
        if (!claim.count) continue;
        try {
          await this.send(job.email, job.subject, job.body);
        } catch {
          this.logger.warn(`Customer email delivery failed for ${job.id}; will retry.`);
          continue;
        }
        await this.prisma.customerEmail.update({
          where: { id: job.id }, data: { sentAt: new Date(), body: '' },
        });
      }
    } catch {
      this.logger.error('Could not process customer email queue.');
    } finally {
      this.running = false;
    }
  }
}
