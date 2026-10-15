import {it,expect} from 'vitest';
import {supabase,scenario,id} from '../../scripts/proof/e04-preparation-ui/sdk';
import {readCommercialPackage} from '../../supabase/functions/_shared/sales-commercial/package-projection';
it('keeps controlled browser proof ports inside the actual canonical package contract',async()=>{
 scenario.reset('ready');const actual=await supabase.rpc('read_sales_commercial_package');
 const read=await readCommercialPackage(id(1),{invoice_id:id(6)},supabase);
 expect(read.content,JSON.stringify(actual)).toMatchObject({success:true,invoice:{id:id(6),client_id:id(2)},agreement:{id:id(4),version:4},schedule_preview:{basis:'recorded_principal_schedule'}});
});
