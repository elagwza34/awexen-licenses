import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Customer, Payment } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../common/prisma/prisma.service';

type CustomerContact = Pick<Customer, 'id' | 'name' | 'email' | 'phone' | 'company' | 'country'>;
type SubscriptionPayment = Pick<Payment, 'id' | 'customerId' | 'amount' | 'currency'>;

@Injectable()
export class OwnerNotificationsService {
  private readonly logger = new Logger(OwnerNotificationsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  registration(customer: CustomerContact, planName?: string) {
    return this.send('تسجيل عميل جديد', customer.id, async () => [
      ...this.contactDetails(customer),
      ...(planName ? [`الخطة المختارة عند التسجيل: ${planName}`] : []),
      `بيانات العميل: ${this.adminLink(`/customers/${customer.id}`)}`,
    ].join('\n'));
  }

  subscription(payment: SubscriptionPayment, planName: string, interval: string) {
    return this.send('طلب اشتراك بانتظار المراجعة', payment.id, async () => {
      const customer = await this.prisma.customer.findUniqueOrThrow({
        where: { id: payment.customerId },
        select: { id: true, name: true, email: true, phone: true, company: true, country: true },
      });
      return [
        ...this.contactDetails(customer),
        `رقم الدفعة: ${payment.id}`,
        `الخطة: ${planName}`,
        `دورة الاشتراك: ${interval === 'YEARLY' ? 'سنوية' : 'شهرية'}`,
        `المبلغ المطلوب: ${(payment.amount / 100).toFixed(2)} ${payment.currency}`,
        `مراجعة الدفعة والموافقة عليها: ${this.adminLink('/payments')}`,
      ].join('\n');
    });
  }

  private contactDetails(customer: CustomerContact) {
    return [
      `رقم العميل: ${customer.id}`,
      `الاسم: ${customer.name}`,
      `البريد الإلكتروني: ${customer.email}`,
      `الهاتف: ${customer.phone || '—'}`,
      `الشركة: ${customer.company || '—'}`,
      `البلد: ${customer.country || '—'}`,
    ];
  }

  private adminLink(path: string) {
    return new URL(path, this.config.get<string>('PORTAL_PUBLIC_URL') || 'https://licenses.awexen.com').href;
  }

  private async send(subject: string, recordId: number, buildText: () => Promise<string>) {
    try {
      const host = this.config.get<string>('SMTP_HOST');
      const user = this.config.get<string>('SMTP_USER');
      const pass = this.config.get<string>('SMTP_PASSWORD');
      const from = this.config.get<string>('SMTP_FROM');
      const port = Number(this.config.get<string>('SMTP_PORT', '587'));
      if (!host || !user || !pass || !from || ![465, 587].includes(port)) {
        this.logger.warn('Owner notification skipped because SMTP is not configured.');
        return;
      }

      const text = await buildText();
      const transport = nodemailer.createTransport({
        host, port, secure: port === 465, requireTLS: true,
        auth: { user, pass },
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        connectionTimeout: 10000, socketTimeout: 15000,
        disableFileAccess: true, disableUrlAccess: true,
      });
      try {
        await transport.sendMail({
          from,
          to: this.config.get<string>('OWNER_NOTIFICATION_EMAIL')?.trim() || 'elagwza34@gmail.com',
          subject: `نظام التراخيص — ${subject} #${recordId}`,
          text,
        });
      } finally {
        transport.close();
      }
    } catch {
      this.logger.error(`Could not deliver owner notification: ${subject} #${recordId}`);
    }
  }
}
