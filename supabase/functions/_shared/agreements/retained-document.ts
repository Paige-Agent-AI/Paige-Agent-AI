import {sha256Hex} from './token.ts';

/** Check the actual retained bytes against the canonical engine digest. This
 * does not parse economics, authorize access, re-render or establish signing. */
export async function verifyRetainedAgreementPdf(bytes:Uint8Array,expected:unknown):Promise<boolean>{
  if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected)||bytes.length<5)return false;
  if(![0x25,0x50,0x44,0x46,0x2d].every((value,index)=>bytes[index]===value))return false;
  return await sha256Hex(bytes)===expected;
}
