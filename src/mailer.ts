import nodemailer from "nodemailer";

export interface Mail {
  to: string[];
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Sends through SMTP; in this project that's Mailpit, which keeps every email and shows it on its web UI. */
export class SmtpMailer implements Mailer {
  private readonly transport;

  constructor(
    host: string,
    port: number,
    private readonly from: string,
  ) {
    // Mailpit speaks plain SMTP without TLS or auth.
    this.transport = nodemailer.createTransport({ host, port, secure: false });
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: mail.to, subject: mail.subject, text: mail.text });
  }
}
