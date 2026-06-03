import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { UserRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly transporter: Transporter | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.transporter = this.createTransporter();
  }

  async notifyGeneralManagersLoanPendingApproval(details: {
    loanId: string;
    amount: number;
    purpose: string;
    clientName: string;
    loanOfficerName?: string | null;
  }) {
    const recipientEmails = await this.getRecipientEmails(
      UserRole.GENERAL_MANAGER,
    );

    if (recipientEmails.length === 0) {
      this.logger.warn(
        'No general manager emails found for pending loan notification',
      );
      return;
    }

    await this.sendMail({
      to: recipientEmails,
      subject: `Loan approval required for ${details.clientName}`,
      text: [
        'A new loan has been created and requires your approval.',
        `Loan ID: ${details.loanId}`,
        `Client: ${details.clientName}`,
        `Amount: ${details.amount}`,
        `Purpose: ${details.purpose}`,
        `Loan Officer: ${details.loanOfficerName ?? 'Loan Officer'}`,
      ].join('\n'),
    });
  }

  async notifyLoanOfficersLoanPendingReview(details: {
    loanId: string;
    amount: number;
    purpose: string;
    clientName: string;
  }) {
    const recipientEmails = await this.getRecipientEmails(
      UserRole.LOAN_OFFICER,
    );

    if (recipientEmails.length === 0) {
      this.logger.warn('No loan officer emails found for pending loan review');
      return;
    }

    await this.sendMail({
      to: recipientEmails,
      subject: `Loan review required for ${details.clientName}`,
      text: [
        'A new client loan request requires loan officer review.',
        `Loan ID: ${details.loanId}`,
        `Client: ${details.clientName}`,
        `Amount: ${details.amount}`,
        `Purpose: ${details.purpose}`,
      ].join('\n'),
    });
  }

  async notifyLoanOfficerLoanApproved(details: {
    loanId: string;
    amount: number;
    clientName: string;
    loanOfficerEmail?: string | null;
    loanOfficerName?: string | null;
  }) {
    if (!details.loanOfficerEmail) {
      this.logger.warn(
        `Loan ${details.loanId} has no loan officer email for approval notification`,
      );
      return;
    }

    await this.sendMail({
      to: details.loanOfficerEmail,
      subject: `Loan approved for ${details.clientName}`,
      text: [
        `Hello ${details.loanOfficerName ?? 'Loan Officer'},`,
        '',
        'The following loan has been approved by the general manager.',
        `Loan ID: ${details.loanId}`,
        `Client: ${details.clientName}`,
        `Amount: ${details.amount}`,
      ].join('\n'),
    });
  }

  async notifyGeneralManagersRepaymentPendingApproval(details: {
    repaymentId: string;
    loanId: string;
    amountPaid: number;
    paymentDate: Date;
    clientName: string;
    source?: 'STAFF_MANUAL' | 'CLIENT_ONLINE';
    paymentReference?: string | null;
  }) {
    const recipientEmails = await this.getRecipientEmails(
      UserRole.GENERAL_MANAGER,
    );

    if (recipientEmails.length === 0) {
      this.logger.warn(
        'No general manager emails found for pending repayment notification',
      );
      return;
    }

    const sourceLabel =
      details.source === 'CLIENT_ONLINE' ? 'online' : 'manual';

    await this.sendMail({
      to: recipientEmails,
      subject: `Repayment approval required for ${details.clientName}`,
      text: [
        `A ${sourceLabel} repayment has been recorded and requires your approval.`,
        `Repayment ID: ${details.repaymentId}`,
        `Loan ID: ${details.loanId}`,
        `Client: ${details.clientName}`,
        `Amount Paid: ${details.amountPaid}`,
        `Payment Date: ${details.paymentDate.toISOString()}`,
        ...(details.paymentReference
          ? [`Payment Reference: ${details.paymentReference}`]
          : []),
      ].join('\n'),
    });
  }

  async notifyLoanOfficerRepaymentApproved(details: {
    repaymentId: string;
    loanId: string;
    amountPaid: number;
    clientName: string;
    loanOfficerEmail?: string | null;
    loanOfficerName?: string | null;
  }) {
    if (!details.loanOfficerEmail) {
      this.logger.warn(
        `Repayment ${details.repaymentId} has no loan officer email for approval notification`,
      );
      return;
    }

    await this.sendMail({
      to: details.loanOfficerEmail,
      subject: `Repayment approved for ${details.clientName}`,
      text: [
        `Hello ${details.loanOfficerName ?? 'Loan Officer'},`,
        '',
        'The following repayment has been approved by the general manager.',
        `Repayment ID: ${details.repaymentId}`,
        `Loan ID: ${details.loanId}`,
        `Client: ${details.clientName}`,
        `Amount Paid: ${details.amountPaid}`,
      ].join('\n'),
    });
  }

  private createTransporter() {
    const host = this.configService.get<string>('SMTP_HOST');
    const portValue = this.configService.get<string>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (!host || !portValue || !user || !pass) {
      this.logger.warn(
        'SMTP is not fully configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM_EMAIL to enable email delivery.',
      );
      return null;
    }

    const options: SMTPTransport.Options = {
      host,
      port: Number(portValue),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user,
        pass,
      },
    };

    return nodemailer.createTransport(options);
  }

  private async getRecipientEmails(role: UserRole) {
    const users = await this.prisma.user.findMany({
      where: {
        roles: {
          has: role,
        },
      },
      select: {
        email: true,
      },
    });

    return users.map((user) => user.email).filter(Boolean);
  }

  private async sendMail(params: {
    to: string | string[];
    subject: string;
    text: string;
  }) {
    if (!this.transporter) {
      this.logger.warn(
        `Skipping email "${params.subject}" because SMTP is not configured`,
      );
      return;
    }

    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL');
    const fromName =
      this.configService.get<string>('SMTP_FROM_NAME') ?? 'GFI Rwanda';

    if (!fromEmail) {
      this.logger.warn(
        `Skipping email "${params.subject}" because SMTP_FROM_EMAIL is not configured`,
      );
      return;
    }

    try {
      await this.transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: params.to,
        subject: params.subject,
        text: params.text,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown email delivery error';
      this.logger.error(`Failed to send "${params.subject}": ${message}`);
    }
  }
}
