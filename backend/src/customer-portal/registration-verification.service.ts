import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { CustomerMailService } from '../common/mail/customer-mail.service';
import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class RegistrationVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: CustomerMailService,
  ) {}

  private digest(email: string, code: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_ACCESS_SECRET'))
      .update(`registration:${email}:${code}`).digest('hex');
  }

  async request(address: string) {
    const email = address.trim().toLowerCase();
    const response = { message: 'لو البريد متاح للتسجيل، هيظهر كود التفعيل في صندوق الوارد.' };
    if (await this.prisma.customer.findUnique({ where: { email }, select: { id: true } })) return response;
    const code = String(randomInt(1000000)).padStart(6, '0');
    const digest = this.digest(email, code);
    const reserved = await this.prisma.$executeRaw`
      INSERT INTO registration_verifications (email, digest, expires_at, resend_at)
      VALUES (${email}, ${digest}, CURRENT_TIMESTAMP + interval '10 minutes', CURRENT_TIMESTAMP + interval '1 minute')
      ON CONFLICT (email) DO UPDATE
      SET digest = EXCLUDED.digest, attempts = 0, expires_at = EXCLUDED.expires_at, resend_at = EXCLUDED.resend_at
      WHERE registration_verifications.resend_at <= CURRENT_TIMESTAMP
        AND (registration_verifications.attempts < 5 OR registration_verifications.expires_at <= CURRENT_TIMESTAMP)
    `;
    if (!reserved) return response;
    try {
      await this.mail.send(email, 'كود تفعيل حسابك', `كود تفعيل حسابك: ${code}\nالكود صالح لمدة 10 دقائق ويُستخدم مرة واحدة.\nإذا لم تطلب التسجيل، تجاهل الرسالة.`);
    } catch {
      await this.prisma.registrationVerification.deleteMany({ where: { email, digest } });
      throw new ServiceUnavailableException('تعذّر إرسال كود التفعيل. حاول مرة أخرى.');
    }
    return response;
  }

  async complete<T>(email: string, code: string, create: (tx: Prisma.TransactionClient) => Promise<T>) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT email FROM registration_verifications WHERE email = ${email} FOR UPDATE`;
      const verification = await tx.registrationVerification.findUnique({ where: { email } });
      if (!verification || verification.expiresAt <= new Date() || verification.attempts >= 5) return null;
      if (!timingSafeEqual(Buffer.from(verification.digest, 'hex'), Buffer.from(this.digest(email, code), 'hex'))) {
        await tx.registrationVerification.update({ where: { email }, data: { attempts: { increment: 1 } } });
        return null;
      }
      const customer = await create(tx);
      await tx.registrationVerification.delete({ where: { email } });
      return customer;
    });
    if (result === null) throw new BadRequestException('كود التفعيل غير صحيح أو انتهت صلاحيته. اطلب كودًا جديدًا.');
    return result;
  }

  @Cron('0 3 * * *', { timeZone: 'UTC' })
  async removeExpiredCodes() {
    await this.prisma.registrationVerification.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
