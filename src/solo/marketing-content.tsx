import { ContentCatalog } from "./content-catalog";
import type { CampaignArtifact } from "./useSoloCampaigns";

export const LIBRARY_READ_LIMIT = 60;
export const PIECE_COLUMNS = "id,kind,channel,status,title,body,image_path,image_url,size,brief,meta,updated_at";

export type MarketingContentProps = {
  tenantId: string | null;
  artifacts: CampaignArtifact[];
  publishedPhase: string;
  onRetryPublished: () => void;
  linkedPieceId?: string | null;
  onClearLinkedPiece?: () => void;
};

export function MarketingContent({ tenantId, artifacts, publishedPhase, onRetryPublished, linkedPieceId, onClearLinkedPiece }: MarketingContentProps) {
  return <div className="content-catalog-shell">
    <header className="content-catalog-title"><h1>Content</h1></header>
    <ContentCatalog key={`${tenantId}:${linkedPieceId ?? ""}`} tenantId={tenantId} artifacts={artifacts} phase={publishedPhase} onRetry={onRetryPublished}
      linkedPieceId={linkedPieceId} onClearLinkedPiece={onClearLinkedPiece}/>
  </div>;
}
