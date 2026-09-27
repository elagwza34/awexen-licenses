import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Stores the bank-transfer receipt a customer uploads.
 *
 * Uploaded files are the one place a stranger can put bytes on the server, so
 * this is deliberately narrow:
 *
 *   - the extension is derived from the *detected* type, never from the name
 *     the client sent, so `evil.png` cannot be saved as a script;
 *   - the stored name is a fresh UUID, so two customers uploading `photo.jpg`
 *     never overwrite each other and the original filename never reaches the
 *     filesystem;
 *   - only image types are accepted at all.
 *
 * The file is referenced by a URL, not a path, so the web server can serve it
 * from one place regardless of where the data directory lives.
 */
@Injectable()
export class ReceiptStorageService {
  private readonly logger = new Logger(ReceiptStorageService.name);

  /** Magic-number prefixes are more trustworthy than the client's claim. */
  private static readonly SIGNATURES: { mime: string; ext: string; bytes: number }[] = [
    { mime: 'image/jpeg', ext: '.jpg', bytes: 0xff },
    { mime: 'image/png', ext: '.png', bytes: 0x89 },
    { mime: 'image/webp', ext: '.webp', bytes: 0x52 },
  ];

  constructor(private readonly config: ConfigService) {}

  private get baseDir(): string {
    return resolve(this.config.get<string>('RECEIPTS_DIR', 'storage/receipts'));
  }

  public get publicPrefix(): string {
    return this.config.get<string>('RECEIPTS_URL_PREFIX', '/receipts');
  }

  async save(file: { buffer: Buffer; originalname: string }): Promise<{ url: string; size: number }> {
    const detected = this.detect(file.buffer);
    if (!detected) {
      throw new BadRequestException('الملف المرفوع ليس صورة. الصيغ المدعومة: JPG أو PNG أو WebP.');
    }

    const name = `${randomUUID()}${detected.ext}`;
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(resolve(this.baseDir, name), file.buffer);

    this.logger.log(`Stored receipt ${name} (${file.buffer.length} bytes, ${detected.mime})`);
    return { url: `${this.publicPrefix}/${name}`, size: file.buffer.length };
  }

  async remove(url: string | null | undefined): Promise<void> {
    if (!url || !url.startsWith(`${this.publicPrefix}/`)) return;
    const name = url.slice(this.publicPrefix.length + 1);
    // Reject any traversal attempt before touching the filesystem.
    if (!name || name.includes('/') || name.includes('..')) return;
    try {
      await unlink(resolve(this.baseDir, name));
    } catch {
      // A missing file is not worth failing the caller's operation over.
    }
  }

  /** Identifies the type from the file's own header bytes. */
  private detect(buffer: Buffer) {
    if (buffer.length < 12) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return ReceiptStorageService.SIGNATURES[0];
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return ReceiptStorageService.SIGNATURES[1];
    }
    // WebP: "RIFF" .... "WEBP"
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return ReceiptStorageService.SIGNATURES[2];
    }
    return null;
  }

  /**
   * Resolves a stored receipt for streaming.
   *
   * Serving the image through the API rather than a static folder means the
   * filename can never be turned into a directory listing, and the content type
   * is derived from this whitelist instead of from anything the client sent.
   */
  async read(name: string): Promise<{ stream: ReadStream; mime: string; size: number }> {
    // Only a bare UUID plus a known image extension is accepted. Anything
    // containing a path separator is refused before the filesystem is touched.
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(name)) {
      throw new NotFoundException('Receipt not found.');
    }

    const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    try {
      const stats = await stat(resolve(this.baseDir, name));
      if (!stats.isFile()) throw new Error('not a file');
      return { stream: createReadStream(resolve(this.baseDir, name)), mime, size: stats.size };
    } catch {
      throw new NotFoundException('Receipt not found.');
    }
  }
}
