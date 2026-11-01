import {useId,useRef,useState} from 'react';
import {Tabs,TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Button} from '@/components/ui/button';
import {KnowledgeDialogFrame} from '@/components/knowledge/KnowledgeDialogFrame';
import {useTenantContext} from '@/hooks/useTenantContext';
import {AddDocDialog} from '@/pages/admin/TenantKnowledgeAdmin';
import {AddKnowledgeFlow} from './AddKnowledgeFlow';
import {BulkKnowledgeUploadFlow} from './BulkKnowledgeUploadFlow';

type Props={tenantId:string;onClose:()=>void;onPublished?:()=>void};
type Source='paste'|'url'|'file';
export function KnowledgeIntakeDialog(props:Props){
  const identity=useTenantContext();
  if(identity.loading||identity.accountContextStatus!=='ready'||!identity.activeUserId||identity.activeTenantId!==props.tenantId){
    return <KnowledgeDialogFrame title="Workspace changed" description="Reopen Knowledge in your current workspace."><Button onClick={props.onClose}>Close</Button></KnowledgeDialogFrame>;
  }
  return <KnowledgeIntakeSession key={`${props.tenantId}:${identity.activeUserId}`} {...props}/>;
}
function KnowledgeIntakeSession({tenantId,onClose,onPublished}:Props){
  const [source,setSource]=useState<Source>('paste');
  const [locked,setLocked]=useState(false),started=useRef(false);
  const prefix=useId();
  const start=()=>{started.current=true;setLocked(true);};
  const choose=(next:string)=>{if(!started.current&&['paste','url','file'].includes(next))setSource(next as Source);};
  return <KnowledgeDialogFrame title="Knowledge" description="Facts and Memory are reviewed separately." className="max-w-2xl max-h-[90dvh] overflow-y-auto">
    <Tabs value={source} onValueChange={choose}>
      <TabsList className="grid h-auto w-full grid-cols-3" aria-label="Knowledge source">
        <TabsTrigger value="paste" disabled={locked&&source!=='paste'} className="min-h-11 px-2">Paste text</TabsTrigger>
        <TabsTrigger value="url" disabled={locked&&source!=='url'} className="min-h-11 px-2">From a link</TabsTrigger>
        <TabsTrigger value="file" disabled={locked&&source!=='file'} className="min-h-11 px-2">Upload files</TabsTrigger>
      </TabsList>
      <TabsContent value="paste" forceMount hidden={source!=='paste'}>
        <AddKnowledgeFlow embedded tenantId={tenantId} onClose={onClose} onPublished={onPublished} onInteractionStart={start}/>
      </TabsContent>
      <TabsContent value="url" forceMount hidden={source!=='url'}>
        <AddDocDialog embedded tenantId={tenantId} initialMode="url" controlIdPrefix={prefix} onClose={onClose} onInteractionStart={start}/>
      </TabsContent>
      <TabsContent value="file" forceMount hidden={source!=='file'}>
        <BulkKnowledgeUploadFlow embedded tenantId={tenantId} onClose={onClose} onBack={()=>choose('paste')} onPublished={onPublished} onInteractionStart={start}/>
      </TabsContent>
    </Tabs>
  </KnowledgeDialogFrame>;
}
