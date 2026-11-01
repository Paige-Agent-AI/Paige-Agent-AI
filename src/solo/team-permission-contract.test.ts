import {describe,expect,it} from 'vitest';
import {verifiedTeamPermissionReceipt,teamPermissionRefusal} from './team-workspace-contract';
describe('original Team permission current-state receipt',()=>{
 it.each(['admin','member'] as const)('accepts only exact native %s for the captured membership',permission=>{
  expect(verifiedTeamPermissionReceipt({membership_id:'seat-1',permission},'seat-1',permission)).toEqual({membership_id:'seat-1',permission});
 });
 it.each([null,{},[],{membership_id:'other',permission:'admin'},{membership_id:'seat-1',permission:'member'},{membership_id:'seat-1',permission:'owner'},{membership_id:'seat-1',permission:'admin',extra:'untrusted'}])('refuses missing, foreign, changed or expanded response %#',value=>{
  expect(verifiedTeamPermissionReceipt(value,'seat-1','admin')).toBeNull();
 });
 it('never renders raw native or transport details',()=>{expect(teamPermissionRefusal('private SQL function body')).not.toContain('private');expect(teamPermissionRefusal('private SQL function body')).toContain('Reopen Team');});
 it.each(['this team membership changed before this could run; nothing was changed','your active workspace changed before this could run; nothing was changed','only the tenant owner may change permission levels','the owner permission cannot be changed here','TEAM_MEMBER_IDENTITY_UNAVAILABLE'])('requires a current Team read after admission changed: %s',message=>{expect(teamPermissionRefusal(message)).toContain('Reopen Team');});
});
