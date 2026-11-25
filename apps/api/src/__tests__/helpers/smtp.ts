import type { Socket, TCPSocketListener } from 'bun';

// A local SMTP server that accepts every message and keeps it, so tests send real mail
// through the instance mail provider (SMTP_HOST / SMTP_PORT) and read what arrived.
// `fail` answers the next transactions with a transient 451, as a provider having
// trouble would.

export interface SunkMail {
  to: string[];
  raw: string;
  headers: Record<string, string>;
  // The text part, quoted-printable decoded.
  text: string;
}

interface Conn {
  buffer: string;
  inData: boolean;
  to: string[];
}

export interface SmtpSink {
  mails: SunkMail[];
  fail: boolean;
  port: number;
  // Points the instance mail provider at the sink.
  use(): void;
  stop(): void;
}

function decodeQuotedPrintable(s: string): string {
  return s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function parse(raw: string, to: string[]): SunkMail {
  const [head = '', ...rest] = raw.split('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  const body = rest.join('\r\n\r\n');
  // A multipart body: the text/plain part comes first.
  const plain = body.match(/Content-Type: text\/plain[^]*?\r\n\r\n([^]*?)\r\n--/i);
  return { to, raw, headers, text: decodeQuotedPrintable(plain ? plain[1]! : body) };
}

export function startSmtpSink(): SmtpSink {
  const sink: SmtpSink = {
    mails: [],
    fail: false,
    port: 0,
    use() {
      process.env.SMTP_HOST = '127.0.0.1';
      process.env.SMTP_PORT = String(sink.port);
      process.env.EMAIL_FROM = 'Plan <plan@example.com>';
    },
    stop() {
      server.stop(true);
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.EMAIL_FROM;
    },
  };
  const reply = (socket: Socket<Conn>, line: string) => socket.write(`${line}\r\n`);
  const server: TCPSocketListener<Conn> = Bun.listen<Conn>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: '', inData: false, to: [] };
        reply(socket, '220 sink ESMTP');
      },
      data(socket, chunk) {
        const conn = socket.data;
        conn.buffer += chunk.toString();
        for (;;) {
          if (conn.inData) {
            const end = conn.buffer.indexOf('\r\n.\r\n');
            if (end < 0) return;
            const raw = conn.buffer.slice(0, end).replace(/\r\n\.\./g, '\r\n.');
            conn.buffer = conn.buffer.slice(end + 5);
            conn.inData = false;
            sink.mails.push(parse(raw, conn.to));
            conn.to = [];
            reply(socket, '250 OK');
            continue;
          }
          const eol = conn.buffer.indexOf('\r\n');
          if (eol < 0) return;
          const line = conn.buffer.slice(0, eol);
          conn.buffer = conn.buffer.slice(eol + 2);
          const verb = line.slice(0, 4).toUpperCase();
          if (verb === 'EHLO' || verb === 'HELO') reply(socket, '250 sink');
          else if (verb === 'MAIL') reply(socket, sink.fail ? '451 try again later' : '250 OK');
          else if (verb === 'RCPT') {
            conn.to.push(line.replace(/^RCPT TO:\s*<?([^>]*)>?.*$/i, '$1'));
            reply(socket, '250 OK');
          } else if (verb === 'DATA') {
            conn.inData = true;
            reply(socket, '354 go ahead');
          } else if (verb === 'QUIT') {
            reply(socket, '221 bye');
            socket.end();
            return;
          } else reply(socket, '250 OK');
        }
      },
    },
  });
  sink.port = server.port;
  return sink;
}
