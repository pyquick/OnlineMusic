import {
  ACCEPTED_FORMATS,
  ASSET_STATUSES,
  MEDIA_KINDS,
  MAX_DESCRIPTION_LENGTH,
  MAX_LYRICS_LENGTH,
  MAX_NAME_LENGTH,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  type AssetMetadata,
  type AssetStatus,
  type CreateAssetInput,
  type MediaKind,
  type UpdateAssetInput,
} from "./assets";

export class AssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssetValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function stringValue(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") throw new AssetValidationError(`${field} must be a string`);
  const result = value.trim();
  if (!result) throw new AssetValidationError(`${field} is required`);
  if (result.length > maxLength) {
    throw new AssetValidationError(`${field} must be ${maxLength} characters or fewer`);
  }
  return result;
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new AssetValidationError(`${field} must be a string`);
  if (value.length > maxLength) {
    throw new AssetValidationError(`${field} must be ${maxLength} characters or fewer`);
  }
  return value.trim();
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new AssetValidationError(`${field} must be a non-negative number`);
  }
  return value;
}

export function validateMetadata(value: unknown): AssetMetadata {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new AssetValidationError("metadata must be an object");

  const metadata: AssetMetadata = {};
  const stringFields = ["title", "artist", "album", "genre"] as const;
  for (const field of stringFields) {
    const parsed = optionalString(value[field], `metadata.${field}`, MAX_NAME_LENGTH);
    if (parsed !== undefined) metadata[field] = parsed;
  }
  const description = optionalString(value.description, "metadata.description", MAX_DESCRIPTION_LENGTH);
  if (description !== undefined) metadata.description = description;
  const lyrics = optionalString(value.lyrics, "metadata.lyrics", MAX_LYRICS_LENGTH);
  if (lyrics !== undefined) metadata.lyrics = lyrics;

  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > MAX_TAGS) {
      throw new AssetValidationError(`metadata.tags must contain ${MAX_TAGS} items or fewer`);
    }
    metadata.tags = value.tags.map((tag, index) =>
      stringValue(tag, `metadata.tags[${index}]`, MAX_TAG_LENGTH),
    );
  }

  const numberFields = ["durationMs", "sizeBytes", "sampleRate", "channels", "bitRate", "trackNo"] as const;
  for (const field of numberFields) {
    const parsed = optionalNumber(value[field], `metadata.${field}`);
    if (parsed !== undefined) metadata[field] = parsed;
  }
  if (value.coverData !== undefined) {
    if (typeof value.coverData !== "string" || value.coverData.length > 12_000_000) throw new AssetValidationError("metadata.coverData is invalid");
    metadata.coverData = value.coverData;
  }
  const mimeType = optionalString(value.mimeType, "metadata.mimeType", MAX_NAME_LENGTH);
  if (mimeType !== undefined) metadata.mimeType = mimeType;

  return metadata;
}

function validateKind(value: unknown): MediaKind {
  if (value === undefined) return "audio";
  if (typeof value !== "string" || !MEDIA_KINDS.includes(value as MediaKind)) {
    throw new AssetValidationError(`mediaKind must be one of: ${MEDIA_KINDS.join(", ")}`);
  }
  return value as MediaKind;
}

function validateStatus(value: unknown): AssetStatus {
  if (value === undefined) return "draft";
  if (typeof value !== "string" || !ASSET_STATUSES.includes(value as AssetStatus)) {
    throw new AssetValidationError(`status must be one of: ${ASSET_STATUSES.join(", ")}`);
  }
  return value as AssetStatus;
}

function validateFormat(value: unknown, mediaKind: MediaKind): string {
  const format = stringValue(value, "format", 20).toLowerCase().replace(/^\./, "");
  if (!ACCEPTED_FORMATS[mediaKind].includes(format)) {
    throw new AssetValidationError(
      `format must be one of: ${ACCEPTED_FORMATS[mediaKind].join(", ")}`,
    );
  }
  return format;
}

export function validateCreateInput(value: unknown): CreateAssetInput {
  if (!isRecord(value)) throw new AssetValidationError("request body must be an object");
  const mediaKind = validateKind(value.mediaKind);
  return {
    name: stringValue(value.name, "name", MAX_NAME_LENGTH),
    mediaKind,
    format: validateFormat(value.format, mediaKind),
    status: validateStatus(value.status),
    metadata: validateMetadata(value.metadata),
  };
}

export function validateUpdateInput(value: unknown): UpdateAssetInput {
  if (!isRecord(value)) throw new AssetValidationError("request body must be an object");
  const result: UpdateAssetInput = {};
  const mediaKind = value.mediaKind === undefined ? undefined : validateKind(value.mediaKind);
  if (value.name !== undefined) result.name = stringValue(value.name, "name", MAX_NAME_LENGTH);
  if (mediaKind !== undefined) result.mediaKind = mediaKind;
  if (value.status !== undefined) result.status = validateStatus(value.status);
  if (value.metadata !== undefined) result.metadata = validateMetadata(value.metadata);
  if (value.format !== undefined) {
    result.format = validateFormat(value.format, mediaKind ?? "audio");
  }
  if (Object.keys(result).length === 0) throw new AssetValidationError("at least one field is required");
  return result;
}
