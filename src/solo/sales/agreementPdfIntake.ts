/** Selection preflight only. The canonical native signing engine must still
 * read/parse/hash the actual retained PDF before anyone is asked to sign. */
export function agreementPdfIntakeProblem(file: Pick<File, 'name' | 'type' | 'size'> | null): string | null {
  if (!file) return 'Choose the PDF you want to retain with this agreement.';
  if (!/\.pdf$/i.test(file.name) || !['', 'application/pdf', 'application/octet-stream'].includes(file.type.toLowerCase()))
    return 'Choose a PDF. Export Word or other documents to PDF before uploading.';
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return 'That PDF is empty. Choose a file with the agreement content.';
  if (file.size > 26214400) return 'Choose a PDF of 25 MB or less.';
  return null;
}
