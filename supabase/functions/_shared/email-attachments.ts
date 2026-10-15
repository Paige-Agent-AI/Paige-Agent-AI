export type EmailAttachment = {filename:string;content:string;contentType:'application/pdf'};
/** Server-only PDF bytes. Never resolve a caller-provided attachment URL. */
export function pdfEmailAttachment(bytes:Uint8Array,number:string):EmailAttachment {
  if(bytes.length>8_000_000||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('INVALID_PDF_ATTACHMENT');
  let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return {filename:`invoice-${/^DRAFT-/i.test(number)?'document':number.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100)}.pdf`,content:btoa(binary),contentType:'application/pdf'};
}
export function attachmentMime(body:string,contentType:string,attachments:EmailAttachment[]):{contentType:string;body:string} {
  if(!attachments.length)return {contentType,body};
  if(attachments.length>1||attachments.some(a=>a.contentType!=='application/pdf'||!/^[A-Za-z0-9._-]{1,120}\.pdf$/.test(a.filename)||a.content.length>10_700_000||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.content)))throw Error('INVALID_EMAIL_ATTACHMENT');
  const boundary=`paige_${crypto.randomUUID().replace(/-/g,'')}`;
  const parts=[`--${boundary}\r\nContent-Type: ${contentType}\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}`,...attachments.map(a=>`--${boundary}\r\nContent-Type: application/pdf; name="${a.filename}"\r\nContent-Disposition: attachment; filename="${a.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${a.content.match(/.{1,76}/g)?.join('\r\n')??''}`),`--${boundary}--`];
  return {contentType:`multipart/mixed; boundary="${boundary}"`,body:parts.join('\r\n')};
}
