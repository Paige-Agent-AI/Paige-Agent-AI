const reasons:Record<string,string>={
 READY_FOR_GOVERNED_REVIEW:'Ready for review. Sending still requires your current approval policy.',
 IMESSAGE_UNAVAILABLE:'iMessage delivery is unavailable until a supported business messaging connection is implemented.',
 WORKSPACE_CHANGED:'The workspace changed. Reload this invoice.',
 INVOICE_RECIPIENT_MISSING:'The frozen invoice has no valid recipient for this channel.',
 TENANT_EMAIL_SENDER_MISSING:'No eligible business email sender was found. Review Connections.',
 EMAIL_PROVIDER_NOT_CONFIGURED:'The managed email provider needs configuration before this invoice can be sent.',
 EMAIL_RECONNECT_REQUIRED:'Reconnect this business email sender in Connections.',
 SMS_ACCOUNT_MISSING:'Set up the business SMS account in Connections.',
 SMS_NUMBER_MISSING:'A verified SMS-capable business number is required.',
 SMS_A2P_NOT_APPROVED:'SMS sending requires an approved A2P registration.',
 BLOCKED_NO_CONSENT:'This recipient has not granted the required SMS consent.',
 BLOCKED_CLIENT_DND:'This client has do-not-disturb enabled.',
 BLOCKED_SUPPRESSED:'This recipient is suppressed from outbound messages.',
 QUEUED_TENANT_DND:'Business do-not-disturb currently holds sending. Check again when it ends.',
 QUEUED_QUIET_HOURS:'Recipient quiet hours currently hold sending. Check again later.',
 RECIPIENT_PREFERENCES_UNVERIFIED:'Recipient sending preferences could not be verified. Retry the check.',
};
export function invoiceDeliveryReadinessCopy(reason:unknown):string{return typeof reason==='string'&&reasons[reason]?reasons[reason]:'Delivery readiness could not be verified. Retry or review Connections.';}
