import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { extractPdfText } from "../src/import/pdf-extract";

const PASSWORD_PADDING = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

function rc4(key: Buffer, input: Buffer): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let index = 0; index < 256; index += 1) {
    j = (j + state[index] + key[index % key.length]) & 0xff;
    [state[index], state[j]] = [state[j], state[index]];
  }
  let i = 0;
  j = 0;
  return Buffer.from(input.map((byte) => {
    i = (i + 1) & 0xff;
    j = (j + state[i]) & 0xff;
    [state[i], state[j]] = [state[j], state[i]];
    return byte ^ state[(state[i] + state[j]) & 0xff];
  }));
}

function padPassword(password: string): Buffer {
  return Buffer.concat([Buffer.from(password, "latin1"), PASSWORD_PADDING]).subarray(0, 32);
}

function objectKey(encryptionKey: Buffer, objectNumber: number): Buffer {
  const object = Buffer.alloc(5);
  object.writeUIntLE(objectNumber, 0, 3);
  return createHash("md5").update(encryptionKey).update(object).digest().subarray(0, 10);
}

function buildPdf(pages: string[], password?: string): Buffer {
  const pageObjects = pages.map((_, index) => 3 + index * 2);
  const contentObjects = pages.map((_, index) => 4 + index * 2);
  const fontObject = 3 + pages.length * 2;
  const encryptionObject = fontObject + 1;
  const fileId = Buffer.from("0123456789abcdef", "hex");
  let encryptionKey: Buffer | null = null;
  let encryptionDictionary = "";

  if (password) {
    const userPassword = padPassword(password);
    const ownerPassword = padPassword("synthetic-owner");
    const ownerKey = rc4(createHash("md5").update(ownerPassword).digest().subarray(0, 5), userPassword);
    const permissions = Buffer.alloc(4);
    permissions.writeInt32LE(-4);
    encryptionKey = createHash("md5")
      .update(userPassword)
      .update(ownerKey)
      .update(permissions)
      .update(fileId)
      .digest()
      .subarray(0, 5);
    const userKey = rc4(encryptionKey, PASSWORD_PADDING);
    encryptionDictionary = `${encryptionObject} 0 obj\n<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${ownerKey.toString("hex")}> /U <${userKey.toString("hex")}> /P -4 >>\nendobj\n`;
  }

  const objects: Buffer[] = [
    Buffer.from("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    Buffer.from(`2 0 obj\n<< /Type /Pages /Kids [${pageObjects.map((object) => `${object} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`),
  ];
  for (let index = 0; index < pages.length; index += 1) {
    objects.push(Buffer.from(`${pageObjects[index]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObjects[index]} 0 R >>\nendobj\n`));
    const plainContent = Buffer.from(`BT /F1 18 Tf 72 720 Td (${pages[index]}) Tj ET`);
    const content = encryptionKey ? rc4(objectKey(encryptionKey, contentObjects[index]), plainContent) : plainContent;
    objects.push(Buffer.concat([Buffer.from(`${contentObjects[index]} 0 obj\n<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("\nendstream\nendobj\n")]));
  }
  objects.push(Buffer.from(`${fontObject} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`));
  if (encryptionDictionary) objects.push(Buffer.from(encryptionDictionary));

  const header = Buffer.from("%PDF-1.3\n%âãÏÓ\n", "binary");
  const offsets: number[] = [0];
  let offset = header.length;
  for (const object of objects) {
    offsets.push(offset);
    offset += object.length;
  }
  const xref = Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("")}`);
  const trailer = Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${password ? ` /Encrypt ${encryptionObject} 0 R /ID [<${fileId.toString("hex")}> <${fileId.toString("hex")}>]` : ""} >>\nstartxref\n${offset}\n%%EOF\n`);
  return Buffer.concat([header, ...objects, xref, trailer]);
}

describe("extractPdfText", () => {
  it("extracts each page and joins them with a page-break separator", async () => {
    await expect(extractPdfText(buildPdf(["Synthetic first page", "Synthetic second page"]), "")).resolves.toBe(
      "Synthetic first page\n\n--- Page break ---\n\nSynthetic second page",
    );
  });

  it("reports a missing or incorrect password for an encrypted PDF", async () => {
    const pdf = buildPdf(["Synthetic secured page"], "correct-password");
    await expect(extractPdfText(pdf, "")).rejects.toThrow("The PDF password is missing or incorrect.");
    await expect(extractPdfText(pdf, "wrong-password")).rejects.toThrow("The PDF password is missing or incorrect.");
  });

  it("reports corrupt input as an unreadable statement", async () => {
    await expect(extractPdfText(Buffer.from("not a PDF"), "")).rejects.toThrow("Could not read text from that PDF statement.");
  });
});
