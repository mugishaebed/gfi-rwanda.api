import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';
import { DocumentOwnerType } from '../generated/prisma/enums';
import { PrismaService } from '../prisma.service';

type UploadedFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

type PreparedDocument = {
  createInput: {
    id: string;
    ownerType: DocumentOwnerType;
    ownerId: string;
    label: string;
    originalFileName: string;
    mimeType: string;
    size: number;
    storageDriver: string;
    storageKey: string;
    uploadedByUserId: string;
  };
  absolutePath: string;
};

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getMaxFileSizeBytes() {
    return Number(
      this.configService.get<string>('DOCUMENT_MAX_FILE_SIZE_BYTES') ??
        10 * 1024 * 1024,
    );
  }

  async prepareDocuments(params: {
    ownerType: DocumentOwnerType;
    ownerId: string;
    labels?: string[];
    files?: UploadedFile[];
    uploadedByUserId: string;
  }) {
    const files = params.files ?? [];
    if (files.length === 0) {
      return [];
    }

    const labels = params.labels ?? [];
    if (labels.length > 0 && labels.length !== files.length) {
      throw new BadRequestException(
        'documentLabels must match the number of uploaded documents',
      );
    }

    const storageDriver =
      this.configService.get<string>('DOCUMENT_STORAGE_DRIVER') ?? 'local';

    if (storageDriver !== 'local') {
      throw new BadRequestException(
        `Unsupported DOCUMENT_STORAGE_DRIVER "${storageDriver}". Currently only "local" is implemented.`,
      );
    }

    const rootPath = this.getStorageRoot();
    const preparedDocuments: PreparedDocument[] = [];

    try {
      for (const [index, file] of files.entries()) {
        const extension = extname(file.originalname) || '';
        const storageKey = join(
          params.ownerType.toLowerCase(),
          params.ownerId,
          `${randomUUID()}${extension}`,
        );
        const absolutePath = join(rootPath, storageKey);

        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, file.buffer);

        preparedDocuments.push({
          absolutePath,
          createInput: {
            id: randomUUID(),
            ownerType: params.ownerType,
            ownerId: params.ownerId,
            label: labels[index] ?? basename(file.originalname, extension),
            originalFileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            storageDriver,
            storageKey,
            uploadedByUserId: params.uploadedByUserId,
          },
        });
      }

      return preparedDocuments;
    } catch (error) {
      await this.cleanupPreparedDocuments(preparedDocuments);
      throw error;
    }
  }

  async createMany(
    preparedDocuments: PreparedDocument[],
    prisma: Pick<PrismaService, 'document'> = this.prisma,
  ) {
    const created = await Promise.all(
      preparedDocuments.map((doc) =>
        prisma.document.create({ data: doc.createInput }),
      ),
    );
    return created.map((document) => this.serializeDocument(document));
  }

  async cleanupPreparedDocuments(preparedDocuments: PreparedDocument[]) {
    await Promise.all(
      preparedDocuments.map((document) =>
        rm(document.absolutePath, { force: true }),
      ),
    );
  }

  async attachDocuments<T extends { id: string }>(
    ownerType: DocumentOwnerType,
    items: T[],
  ) {
    if (items.length === 0) {
      return items.map((item) => ({ ...item, documents: [] }));
    }

    const ids = items.map((item) => item.id);
    const documents = await this.prisma.document.findMany({
      where: {
        ownerType,
        ownerId: {
          in: ids,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const documentsByOwner = new Map<
      string,
      ReturnType<typeof this.serializeDocument>[]
    >();
    for (const document of documents) {
      const serializedDocument = this.serializeDocument(document);
      const existing = documentsByOwner.get(document.ownerId) ?? [];
      existing.push(serializedDocument);
      documentsByOwner.set(document.ownerId, existing);
    }

    return items.map((item) => ({
      ...item,
      documents: documentsByOwner.get(item.id) ?? [],
    }));
  }

  async getDocumentForDownload(id: string) {
    const document = await this.prisma.document.findUnique({
      where: { id },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    if (document.storageDriver !== 'local') {
      throw new BadRequestException(
        'Only local documents can be downloaded through this endpoint',
      );
    }

    return {
      document: this.serializeDocument(document),
      stream: createReadStream(
        join(this.getStorageRoot(), document.storageKey),
      ),
      mimeType: document.mimeType,
      originalFileName: document.originalFileName,
    };
  }

  private serializeDocument(document: {
    id: string;
    ownerType: DocumentOwnerType;
    ownerId: string;
    label: string;
    originalFileName: string;
    mimeType: string;
    size: number;
    storageDriver: string;
    storageKey: string;
    uploadedByUserId: string;
    createdAt: Date;
  }) {
    const publicBaseUrl = this.configService
      .get<string>('DOCUMENT_STORAGE_PUBLIC_BASE_URL')
      ?.replace(/\/$/, '');

    return {
      ...document,
      downloadUrl: publicBaseUrl
        ? `${publicBaseUrl}/${document.storageKey.replace(/\\/g, '/')}`
        : `/documents/${document.id}/download`,
    };
  }

  private getStorageRoot() {
    return (
      this.configService.get<string>('DOCUMENT_STORAGE_ROOT') ??
      join(process.cwd(), 'storage')
    );
  }
}
