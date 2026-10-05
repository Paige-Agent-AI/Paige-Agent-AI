import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
/** Fail clearly before a scanner misreports invalid UTF-8 as an inaccessible target. */
export function checkSourceUtf8(files, read=readFileSync) {
  const errors=[];
  for (const file of files) {
    try { new TextDecoder('utf-8',{fatal:true}).decode(read(file)); }
    catch (error) { errors.push(`${file}: ${error.code && error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA' ? `cannot read source (${error.code})` : 'invalid UTF-8; save the source as UTF-8 before scanning'}`); }
  }
  return errors;
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const errors=checkSourceUtf8(process.argv.slice(2));
  for(const error of errors) console.error(`source-encoding: ${error}`);
  if(errors.length) process.exitCode=1;
}
