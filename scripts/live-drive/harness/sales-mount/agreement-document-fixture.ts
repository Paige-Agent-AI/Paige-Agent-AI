// In-memory neutral PDF fixture through the ORIGINAL parser/descriptor/hash.
// stdout is fixture JSON, not a customer agreement or exported legal document.
import {PDFDocument,StandardFonts,degrees} from 'npm:pdf-lib@1.17.1';
import {inspectAgreementPreparationPdf} from '../../../../supabase/functions/_shared/agreements/document-preparation.ts';
import {sha256Hex} from '../../../../supabase/functions/_shared/agreements/token.ts';
const pdf=await PDFDocument.create();
pdf.setCreationDate(new Date('2026-10-21T12:00:00Z'));pdf.setModificationDate(new Date('2026-10-21T12:00:00Z'));
const font=await pdf.embedFont(StandardFonts.Helvetica);
const first=pdf.addPage([612,792]);first.drawText('CONTROLLED DOCUMENT - PAGE ONE',{x:40,y:740,size:17,font});
first.drawText('Actual native PDF bytes for source-only page and field verification.',{x:40,y:710,size:11,font});
first.drawText('No legal terms, customer signature, payment or native save is represented.',{x:40,y:688,size:11,font});
const second=pdf.addPage([500,720]);second.setCropBox(18,36,400,600);second.setRotation(degrees(90));
second.drawText('CONTROLLED PAGE TWO - ROTATED CROP',{x:45,y:590,size:13,font});
second.drawText('Geometry is verified against the original native inspector.',{x:45,y:560,size:10,font});
const bytes=await pdf.save({useObjectStreams:false});const descriptor=await inspectAgreementPreparationPdf(bytes,await sha256Hex(bytes));
const signers=[
 {id:'d1111111-0000-4000-8000-000000000001',full_name:'Controlled Client',email:'client@example.test',signer_role:'counterparty',signing_order:1,status:'pending'},
 {id:'d2222222-0000-4000-8000-000000000002',full_name:'Controlled Business Signer',email:'business@example.test',signer_role:'tenant_signatory',signing_order:1,status:'pending'},
];
console.log(JSON.stringify({bytes:btoa(String.fromCharCode(...bytes)),document:descriptor,signers,source:{tenant_id:'aaaaaaaa-0000-4000-8000-000000000001',agreement_id:'e1111111-0000-4000-8000-000000000001',client_id:'cccccccc-0000-4000-8000-000000000001',version:1,updated_at:'2026-10-21T12:00:00.123456+00:00',status:'draft',signers}}));
