import { GROWTH_PAGE_PUBLISH_CAPABILITY, GROWTH_PAGE_UNPUBLISH_CAPABILITY } from "./growth_page.ts";
import { GROWTH_FORM_PUBLISH_CAPABILITY, GROWTH_FORM_UNPUBLISH_CAPABILITY } from "./growth_form.ts";
import { GROWTH_FUNNEL_PUBLISH_CAPABILITY, GROWTH_FUNNEL_UNPUBLISH_CAPABILITY } from "./growth_funnel.ts";
import { STUDIO_IMAGE_PUBLISH_CAPABILITY, STUDIO_IMAGE_UNPUBLISH_CAPABILITY } from "./studio_image.ts";

/**
 * The Vibe Studio publish lifecycle, by canonical action-risk key — the declarations the
 * growth-publish-command door hands to decideDeclaredCapability, exactly as sales-invoice-command
 * uses SALES_INVOICE_KIT_BY_ACTION. One lookup for every act the door may run, for the Studio panel
 * and the chat alike; no alternate execution, permission or approval channel is created here.
 *
 * Every entry is `high` + `confirm` with record_capability_run as its receipt, which is what
 * decideDeclaredCapability requires of a governed mutation. scripts/ci/action-risk-lint.mjs reads
 * this map's keys as the door's declared acts once the door exists, and requires the door to bind it.
 */
export const STUDIO_PUBLISH_KIT_BY_ACTION = {
  growth_page_publish: GROWTH_PAGE_PUBLISH_CAPABILITY,
  growth_page_unpublish: GROWTH_PAGE_UNPUBLISH_CAPABILITY,
  growth_form_publish: GROWTH_FORM_PUBLISH_CAPABILITY,
  growth_form_unpublish: GROWTH_FORM_UNPUBLISH_CAPABILITY,
  growth_funnel_publish: GROWTH_FUNNEL_PUBLISH_CAPABILITY,
  growth_funnel_unpublish: GROWTH_FUNNEL_UNPUBLISH_CAPABILITY,
  studio_image_publish: STUDIO_IMAGE_PUBLISH_CAPABILITY,
  studio_image_unpublish: STUDIO_IMAGE_UNPUBLISH_CAPABILITY,
} as const;
