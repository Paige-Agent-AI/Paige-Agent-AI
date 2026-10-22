// Synthetic input ports only; the original shell, workspace, finding drawer and CSS are mounted.
const keys = ['company_info_populated','website_connected','crm_has_customers','sales_pipeline_configured','revenue_tracking_configured','payment_processor_connected','payment_method_options','comms_configured','social_accounts_connected','automation_wired'];
const at = '2026-10-22T09:00:00Z';
export function useSystemsCheck() {
  const state = new URLSearchParams(location.search).get('state');
  const findings = keys.filter(key => !(state === 'missing' && key === 'website_connected')).map((key, i) => ({
    id: 'test-finding-' + i, run_id:'test-run', check_id:key,
    status: key === 'payment_processor_connected' || key === 'payment_method_options' ? 'fail' : 'pass',
    severity_at_finding: key === 'payment_processor_connected' ? 'blocking' : 'low',
    evidence: key === 'social_accounts_connected' ? {social_handle_count:1,declared_capture_only:true} : {state:'Recorded setup only'},
    paige_interpretation: key === 'social_accounts_connected' ? 'One social handle is recorded. Publishing has not been tested.' : 'This recorded setup result does not verify a business action.',
    paige_drafted_fix:null, department_id:null, resolved_at: state === 'resolved' && key === 'social_accounts_connected' ? at : null,
    resolution: state === 'resolved' && key === 'social_accounts_connected' ? 'Reviewed by owner.' : null,
    resolution_action_id:null, created_at:at,check_name:key,domain:'setup',priority:i,
  }));
  const empty = state === 'empty';
  return {run:empty ? null : {id:'test-run',started_at:at,completed_at:at,check_count:10,pass_count:8,fail_count:2},
    findings:empty ? [] : findings,loading:state==='loading',isError:state==='error',scanPending:false,scanInProgressSince:null,
    refresh:()=>undefined};
}
