import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Read all text in a password-protected statement without writing it to disk. */
export async function extractPdfText(data: Buffer | Uint8Array, password: string): Promise<string> {
  let task: ReturnType<typeof getDocument> | undefined;
  try {
    task = getDocument({ data: new Uint8Array(data), password: password.trim() || undefined });
    const document = await task.promise;
    const pages = await Promise.all(Array.from({ length: document.numPages }, async (_, index) => {
      const page = await document.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items
        .map((item) => "str" in item ? item.str : "")
        .join(" ");
    }));
    return pages.join("\n\n--- Page break ---\n\n");
  } catch (error) {
    if ((error as { name?: string }).name === "PasswordException") {
      throw new Error("The PDF password is missing or incorrect.");
    }
    throw new Error("Could not read text from that PDF statement.");
  } finally {
    await task?.destroy();
  }
}
